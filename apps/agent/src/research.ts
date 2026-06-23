/**
 * Autonomous multi-source research agent (RFB 1).
 *
 * Given a natural-language query, the agent runs the full loop on its own:
 *
 *   1. DISCOVER   — read the machine catalog at /.well-known/agent-skills.json
 *                   (every skill for sale, with prices and preview URLs).
 *   2. PREVIEW    — fetch each skill's FREE block 0 (no payment) to judge it.
 *   3. EVALUATE   — score every candidate's relevance to the query (LLM when an
 *                   API key is present, deterministic heuristic otherwise).
 *   4. BUDGET     — pick the best sources greedily, clearing each estimated cost
 *                   through a spend policy (per-purchase cap + total budget).
 *   5. PAY        — unlock the chosen sources block-by-block over x402 + Gateway
 *                   (reusing the proven runAgentSkills loop).
 *   6. SYNTHESIZE — write a cited answer grounded ONLY in what it paid for.
 *
 * The decision of WHAT to buy (and what to skip) is the agent's, made from the
 * previews and the budget — not a hard-coded slug. Runs fully in simulate mode
 * with no API key (heuristic brain), so a reviewer can see it end-to-end.
 */
import { runAgentSkills } from "./agent-skills-client.js";

export interface ResearchOptions {
  baseUrl: string;
  query: string;
  simulate: boolean;
  /** Total the run may spend, in USDC (default 0.50). */
  budgetUsdc?: number;
  /** Max distinct sources to pay for (default 3). */
  maxSources?: number;
  /** Cap blocks unlocked per source (default 8). */
  perSourceMaxBlocks?: number;
  /** Skip sources scoring below this relevance (0..1, default 0.15). */
  minScore?: number;
}

interface CatalogService {
  name: string;
  slug: string;
  description: string;
  creator: string | null;
  price_per_block: string;
  payable_blocks: number;
  preview_url: string;
}

interface ScoredSource extends CatalogService {
  preview: string;
  score: number;
  reason: string;
}

interface PurchasedSource {
  n: number;
  slug: string;
  name: string;
  creator: string | null;
  blocks: number;
  spent: string;
  text: string;
}

export interface ResearchStep {
  phase: "discover" | "preview" | "evaluate" | "budget" | "pay" | "skip" | "synthesize" | "done";
  thought: string;
}

export interface ResearchResult {
  query: string;
  brain: "llm" | "heuristic";
  modelLabel: string;
  discovered: number;
  scored: { name: string; slug: string; score: number; reason: string }[];
  purchased: PurchasedSource[];
  citations: { n: number; name: string; slug: string; creator: string | null }[];
  answer: string;
  spent: string;
  budget: string;
  steps: ResearchStep[];
}

// ── LLM loader (provider-agnostic via LangChain; null → heuristic) ────────────
async function getModel(): Promise<{ model: any; label: string } | null> {
  const provider = (process.env.AGENT_PROVIDER ?? "").toLowerCase();
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useGroq = provider === "groq" || (provider === "" && hasGroq);
  const useAnthropic = provider === "anthropic" || (provider === "" && !hasGroq && hasAnthropic);

  if (useGroq && hasGroq) {
    const { ChatGroq } = await import("@langchain/groq");
    const model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    return { model: new ChatGroq({ model, maxTokens: 1500, temperature: 0.3 }), label: `Groq · ${model}` };
  }
  if (useAnthropic && hasAnthropic) {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const model = process.env.AGENT_MODEL ?? "claude-opus-4-8";
    return { model: new ChatAnthropic({ model, maxTokens: 1500 }), label: `Claude · ${model}` };
  }
  return null;
}

async function llmText(model: any, prompt: string): Promise<string> {
  const res = await model.invoke(prompt);
  return typeof res?.content === "string" ? res.content : String(res?.content ?? "");
}

function extractJson<T>(text: string): T | null {
  const m = text.match(/[[{][\s\S]*[\]}]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

// ── Heuristic relevance (no API key) ─────────────────────────────────────────
function keywordScore(query: string, s: CatalogService, preview: string): number {
  const q = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (q.length === 0) return 0;
  const hay = `${s.name} ${s.description} ${preview}`.toLowerCase();
  const hits = q.filter((w) => hay.includes(w)).length;
  return Math.min(1, hits / q.length);
}

const usd = (baseUnits: number) => (baseUnits / 1e6).toFixed(6);

export async function runResearch(opts: ResearchOptions): Promise<ResearchResult> {
  const { baseUrl, query, simulate } = opts;
  const budgetUsdc = opts.budgetUsdc ?? 0.5;
  const maxSources = opts.maxSources ?? 3;
  const perSourceMaxBlocks = opts.perSourceMaxBlocks ?? 8;
  const minScore = opts.minScore ?? 0.15;
  const budgetUnits = Math.round(budgetUsdc * 1e6);

  const steps: ResearchStep[] = [];
  const log = (phase: ResearchStep["phase"], thought: string) => {
    steps.push({ phase, thought });
    console.log(`  ${phase.padEnd(10)} ${thought}`);
  };

  const llm = await getModel();
  const model = llm?.model ?? null;
  const brain: "llm" | "heuristic" = model ? "llm" : "heuristic";
  const modelLabel = llm?.label ?? "heuristic (no API key)";
  log("discover", `brain: ${modelLabel}`);

  // 1. DISCOVER ────────────────────────────────────────────────────────────
  const base = baseUrl.replace(/\/$/, "");
  const catRes = await fetch(`${base}/.well-known/agent-skills.json`);
  if (!catRes.ok) throw new Error(`catalog fetch failed (${catRes.status})`);
  const catalog = (await catRes.json()) as { services?: CatalogService[] };
  const services = (catalog.services ?? []).filter((s) => s.slug && Number(s.price_per_block) >= 0);
  log("discover", `${services.length} skill(s) for sale in the catalog`);
  if (services.length === 0) {
    return {
      query, brain, modelLabel, discovered: 0, scored: [], purchased: [], citations: [],
      answer: "No agent skills are listed for sale, so there was nothing to research.",
      spent: "0.000000", budget: budgetUsdc.toFixed(6), steps,
    };
  }

  // 2. PREVIEW (free block 0 of each) ────────────────────────────────────────
  const previews = await Promise.all(
    services.map(async (s) => {
      try {
        const r = await fetch(s.preview_url);
        return r.ok ? (await r.text()).slice(0, 1200) : "";
      } catch {
        return "";
      }
    })
  );
  log("preview", `fetched ${previews.filter(Boolean).length} free preview(s)`);

  // 3. EVALUATE ──────────────────────────────────────────────────────────────
  let scored: ScoredSource[];
  if (model) {
    const list = services
      .map((s, i) => `#${i} "${s.name}" — ${s.description}\nPREVIEW: ${previews[i].slice(0, 400)}`)
      .join("\n\n");
    const prompt =
      `You are a research agent with a budget. Query: "${query}"\n\n` +
      `Score each source 0..1 for how useful it is to answer the query, and give a one-line reason.\n` +
      `Return ONLY JSON: [{"i":0,"score":0.0,"reason":"..."}].\n\n${list}`;
    const judged = extractJson<{ i: number; score: number; reason: string }[]>(await llmText(model, prompt)) ?? [];
    const byIndex = new Map(judged.map((j) => [j.i, j]));
    scored = services.map((s, i) => {
      const j = byIndex.get(i);
      return {
        ...s,
        preview: previews[i],
        score: typeof j?.score === "number" ? Math.max(0, Math.min(1, j.score)) : keywordScore(query, s, previews[i]),
        reason: j?.reason ?? "scored by keyword overlap (LLM gave no verdict)",
      };
    });
  } else {
    scored = services.map((s, i) => ({
      ...s,
      preview: previews[i],
      score: keywordScore(query, s, previews[i]),
      reason: "keyword overlap with the query",
    }));
  }
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored.slice(0, 6)) log("evaluate", `${s.score.toFixed(2)}  ${s.name} — ${s.reason}`);

  // 4. BUDGET + 5. PAY ───────────────────────────────────────────────────────
  const perPurchaseCapUnits = Math.round((budgetUnits / Math.max(1, maxSources)) * 1.5);
  let spentUnits = 0;
  const purchased: PurchasedSource[] = [];

  for (const s of scored) {
    if (purchased.length >= maxSources) break;
    if (s.score < minScore) {
      log("skip", `${s.name} — relevance ${s.score.toFixed(2)} below ${minScore}`);
      continue;
    }
    const priceUnits = Math.round(Number(s.price_per_block) * 1e6);
    const plannedBlocks = Math.min(s.payable_blocks, perSourceMaxBlocks);
    const estUnits = priceUnits * plannedBlocks;
    const remaining = budgetUnits - spentUnits;

    if (estUnits > perPurchaseCapUnits) {
      log("skip", `${s.name} — est $${usd(estUnits)} over per-source cap $${usd(perPurchaseCapUnits)}`);
      continue;
    }
    if (estUnits > remaining) {
      log("skip", `${s.name} — est $${usd(estUnits)} over remaining budget $${usd(remaining)}`);
      continue;
    }

    log("pay", `buying up to ${plannedBlocks} block(s) of "${s.name}" (~$${usd(estUnits)})`);
    let res;
    try {
      res = await runAgentSkills({ baseUrl, slug: s.slug, simulate, maxBlocks: plannedBlocks, includeText: true });
    } catch (e) {
      log("skip", `${s.name} — payment failed: ${(e as Error)?.message ?? e}`);
      continue;
    }
    const paidUnits = Math.round(Number(res.spent) * 1e6);
    spentUnits += paidUnits;
    const body = [res.block0, ...res.blocks.filter((b) => b.status === "paid" && b.text).map((b) => b.text!)]
      .filter(Boolean)
      .join("\n\n");
    const n = purchased.length + 1;
    purchased.push({
      n,
      slug: s.slug,
      name: s.name,
      creator: s.creator,
      blocks: res.blocks.filter((b) => b.status === "paid").length,
      spent: res.spent,
      text: body,
    });
    log("pay", `unlocked "${s.name}" — ${purchased[purchased.length - 1].blocks} paid block(s), $${res.spent}; budget left $${usd(budgetUnits - spentUnits)}`);
  }

  // 6. SYNTHESIZE ──────────────────────────────────────────────────────────────
  let answer: string;
  if (purchased.length === 0) {
    answer = "The agent found candidates but none cleared the relevance threshold or fit the budget, so it bought nothing and has no grounded answer.";
    log("done", "no sources purchased");
  } else if (model) {
    const sources = purchased
      .map((p) => `[${p.n}] "${p.name}" by ${p.creator ?? "unknown"}\n${p.text.slice(0, 2500)}`)
      .join("\n\n");
    const prompt =
      `Answer the query using ONLY the paid sources below. Cite inline as [1], [2]. ` +
      `Be concise and concrete; do not invent facts not in the sources.\n\nQuery: "${query}"\n\nSOURCES:\n${sources}`;
    answer = (await llmText(model, prompt)).trim();
    log("synthesize", `wrote a cited answer from ${purchased.length} source(s)`);
  } else {
    // Heuristic synthesis: pull the query-relevant sentences from each source.
    const terms = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const lines: string[] = [];
    for (const p of purchased) {
      const sents = p.text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
      const pick = sents.filter((x) => terms.some((t) => x.toLowerCase().includes(t))).slice(0, 2);
      (pick.length ? pick : sents.slice(0, 1)).forEach((x) => lines.push(`${x} [${p.n}]`));
    }
    answer =
      `(heuristic synthesis — set GROQ_API_KEY or ANTHROPIC_API_KEY for a written answer)\n\n` +
      lines.join("\n");
    log("synthesize", `extracted ${lines.length} relevant line(s) from ${purchased.length} source(s)`);
  }

  log("done", `spent $${usd(spentUnits)} of $${budgetUsdc.toFixed(6)} across ${purchased.length} source(s)`);

  return {
    query,
    brain,
    modelLabel,
    discovered: services.length,
    scored: scored.map((s) => ({ name: s.name, slug: s.slug, score: s.score, reason: s.reason })),
    purchased,
    citations: purchased.map((p) => ({ n: p.n, name: p.name, slug: p.slug, creator: p.creator })),
    answer,
    spent: usd(spentUnits),
    budget: budgetUsdc.toFixed(6),
    steps,
  };
}
