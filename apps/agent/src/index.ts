// Primary: the agent-skills 402 → pay → unlock consumer (chunk system).
export { runAgentSkills } from "./agent-skills-client.js";
export type {
  AgentSkillsOptions,
  AgentSkillsResult,
  BlockTrace,
} from "./agent-skills-client.js";

// Autonomous multi-source research agent (current). Discovers the
// /.well-known/agent-skills.json catalog, scores relevance, pays for the best
// sources under a budget over x402, and synthesizes a cited answer.
export { runResearch } from "./research.js";
export type { ResearchResult, ResearchOptions, ResearchStep } from "./research.js";

// Legacy: the original line-based research flow drove endpoints removed in the
// chunk migration (/api/catalog, /api/content/:id). Kept for reference only.
export { X402Client } from "./x402-client.js";
