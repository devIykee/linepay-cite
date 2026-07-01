import Link from "next/link";
import { Code, H2, DocsTabs } from "../_components/DocsUI";

export const metadata = {
  title: "Integrations · Docs",
  description:
    "Connect Skimflow to the tools you already use: auto-sync posts from Ghost, expose an x402 full-content API for AI agents and HTTP clients, and make your work auto-discoverable in RSS readers like Folo and RSSHub Radar.",
  alternates: { canonical: "/docs/integrations" },
};

export default function IntegrationsDocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <DocsTabs active="integrations" />

      <header className="mb-8">
        <span className="label-caps text-primary">DOCUMENTATION · INTEGRATIONS</span>
        <h1 className="mt-1 font-display-lg text-display-lg-mobile md:text-display-lg">Plug Skimflow into your stack</h1>
        <p className="mt-2 max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
          Keep writing where you already write, sell to software as well as people, and let readers discover you from
          their favourite RSS app. Three integrations, no extra accounts: <strong>Ghost</strong> sync, an{" "}
          <strong>x402 citation toll</strong> for AI clients, and <strong>RSS auto-discovery</strong> for Folo and
          RSSHub Radar.
        </p>
      </header>

      {/* TOC */}
      <nav className="mb-stack-lg mt-stack-md flex flex-wrap gap-2">
        {[
          ["ghost", "Ghost sync"],
          ["ghost-setup", "Connect Ghost"],
          ["ghost-detect", "Auto-detected types"],
          ["citation", "Citation toll (x402)"],
          ["citation-api", "full-content API"],
          ["rss", "RSS & Folo"],
          ["rss-radar", "RSSHub Radar"],
          ["distribution", "Grow distribution"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="pill">{label}</a>
        ))}
      </nav>

      {/* ───────────────────────── Ghost ───────────────────────── */}
      <H2 id="ghost">Ghost CMS sync</H2>
      <p className="font-body-md text-on-surface-variant">
        Write in Ghost, monetize on Skimflow. Connect your blog once and every time you hit <strong>Publish</strong> in
        Ghost, the post syncs here automatically, split into payable blocks, with a free preview. Ghost stays your
        writing tool; Skimflow becomes the paywall. You never have to migrate.
      </p>
      <ul className="mt-stack-md grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          ["1", "Connect once", "Add your Ghost site URL and API keys in Settings → Integrations, then paste one webhook into Ghost."],
          ["2", "Publish in Ghost", "When you publish a post, Ghost notifies Skimflow. We fetch the full post and split it into blocks."],
          ["3", "Review or auto-publish", "Posts land in your Skimflow drafts to review, or publish instantly, your choice."],
        ].map(([n, title, body]) => (
          <li key={n} className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary font-data-mono text-[13px] text-on-primary">{n}</div>
            <div className="mt-2 font-label-lg text-label-lg">{title}</div>
            <p className="mt-1 font-body-sm text-on-surface-variant">{body}</p>
          </li>
        ))}
      </ul>

      <H2 id="ghost-setup">Connecting Ghost</H2>
      <p className="font-body-md text-on-surface-variant">
        Open <Link href="/dashboard/settings" className="text-primary">Settings → Integrations</Link> and fill in the
        Ghost card:
      </p>
      <ul className="mt-stack-md list-disc space-y-1 pl-6 font-body-md text-on-surface-variant">
        <li><strong>Ghost site URL</strong> — e.g. <span className="font-data-mono text-body-sm">https://myblog.ghost.io</span>.</li>
        <li><strong>Content API key</strong> — read-only key from Ghost Admin → Settings → Integrations. Used to fetch the full post.</li>
        <li><strong>Admin API key</strong> — used to verify that incoming webhooks really came from your Ghost. Stored encrypted, server-side only, and never shown again.</li>
        <li><strong>Default monetization</strong> — <em>Free</em> or <em>Pay per block</em>, applied to every incoming post (you can still edit any post in drafts before publishing).</li>
        <li><strong>Auto-publish</strong> — off by default. Off → posts wait in drafts for review. On → posts publish immediately using your default monetization. Auto-publish needs a payout wallet on file; without one, incoming posts safely fall back to drafts so nothing publishes unpaid.</li>
      </ul>
      <p className="mt-stack-md font-body-md text-on-surface-variant">
        After you save, Skimflow shows the exact webhook to add in <strong>Ghost Admin → Settings → Integrations → your
        integration → Add webhook</strong>:
      </p>
      <Code lang="text">{`Event:       Post published
Target URL:  https://<your-deployment>/api/webhooks/ghost?creator=<your-id>`}</Code>
      <p className="font-body-sm text-on-surface-variant">
        The card gives you a one-tap <strong>Copy</strong> button for the exact URL (your creator id is already baked
        in). The connection status reads <strong>Unconnected</strong> until your first published post arrives, then
        flips to <strong>Connected</strong>. If a webhook signature ever fails, it shows <strong>Error</strong> with a
        plain-language reason (usually a mismatched Admin API key).
      </p>
      <div className="mt-stack-md rounded-xl border border-outline-variant bg-surface-container-low p-4">
        <div className="font-label-lg text-label-lg">Testing &amp; local development</div>
        <p className="mt-1 font-body-sm text-on-surface-variant">
          Ghost delivers webhooks by calling your Target URL, so it has to be reachable from the public internet. On a
          deployed Skimflow that just works. Running locally? Put a tunnel (e.g.{" "}
          <span className="font-data-mono text-body-sm">ngrok</span>) in front of your dev server and use the tunnel&apos;s
          HTTPS URL as the webhook host. To check the pipeline end to end, publish a post in Ghost (or re-save one) and
          watch for the draft/notification to appear in your dashboard — the connection status flips to{" "}
          <strong>Connected</strong> on the first successful delivery.
        </p>
      </div>
      <div className="mt-stack-md rounded-xl border border-outline-variant bg-surface-container-low p-4">
        <div className="font-label-lg text-label-lg">Security</div>
        <p className="mt-1 font-body-sm text-on-surface-variant">
          Both keys are encrypted at rest (AES-256-GCM) and only ever decrypted on the server. The Admin API key is
          never returned to your browser, never logged, and never appears in error messages. Every webhook is signature
          -verified before anything is processed, and re-deliveries of the same post are ignored (idempotent), so a
          double-fired webhook can never create a duplicate.
        </p>
      </div>

      <H2 id="ghost-detect">Auto-detected content types</H2>
      <p className="font-body-md text-on-surface-variant">
        Skimflow maps each Ghost post to one of its content types automatically, then splits it into coherent blocks
        (headings start new blocks, code and quotes stay whole, images stay with their context). You don&apos;t have to
        tag anything, but tags help:
      </p>
      <ul className="mt-stack-md grid grid-cols-1 gap-3 md:grid-cols-2">
        {[
          ["picture", "Image-heavy posts (lots of pictures, little text), or anything tagged photo / photography / gallery / visual. Each image becomes its own unlockable block."],
          ["book", "Long serialized posts (1,500+ words) tagged series / chapter / part / episode / fiction / serial, or with a title like “Chapter 3”. The chapter number is kept for ordering."],
          ["agent-skills", "Code-heavy posts (40%+ code), or anything tagged agent / skill / tool / prompt / automation, or titled “skill: …”. The intro is the free teaser; each code block + its explanation is a block."],
          ["article", "The default for everything else: prose, split block by block with a free first block."],
        ].map(([k, d]) => (
          <li key={k} className="rounded-lg border border-on-surface/10 bg-surface-container-lowest p-3">
            <span className="font-data-mono text-body-sm text-primary">{k}</span>
            <p className="font-body-sm text-on-surface-variant">{d}</p>
          </li>
        ))}
      </ul>
      <p className="mt-stack-md font-body-sm text-on-surface-variant">
        Got a draft you weren&apos;t expecting? Open it in the dashboard, fix the type or blocks, and publish. Every
        sync also drops an in-app notification (&ldquo;New post from Ghost is ready to review&rdquo;) so nothing slips by.
      </p>

      {/* ───────────────────── Citation toll ───────────────────── */}
      <H2 id="citation">Citation toll for AI agents (x402)</H2>
      <p className="font-body-md text-on-surface-variant">
        Every published <span className="font-data-mono text-body-sm">article</span> gets a second, machine-facing
        door: a single endpoint where an AI agent or HTTP client can buy the <em>whole</em> article in one payment and
        get clean, structured content back, ready to cite. This is separate from the human block-unlock flow; readers on
        the page are completely unaffected.
      </p>
      <p className="mt-stack-md font-body-md text-on-surface-variant">
        It uses the same <a href="https://www.x402.org" className="text-primary" target="_blank" rel="noreferrer">x402</a>{" "}
        pay-to-unlock pattern and the same Circle Gateway USDC rail as the rest of Skimflow. Payment goes straight to{" "}
        <strong>your</strong> wallet, never a platform address.
      </p>

      <H2 id="citation-api">The full-content API</H2>
      <Code lang="http">{`GET /api/articles/<postId>/full-content`}</Code>
      <p className="font-body-md text-on-surface-variant">
        Free articles return <span className="font-data-mono text-body-sm">200</span> immediately. Paid articles answer{" "}
        <span className="font-data-mono text-body-sm">402 Payment Required</span> with a price quote and these headers:
      </p>
      <Code lang="http">{`X-Payment-Required: true
X-Payment-Amount:   <sum of all paid block prices>
X-Payment-Currency: USDC
X-Payment-Network:  ARC-TESTNET
X-Payment-Address:  <the creator's Circle wallet>`}</Code>
      <p className="font-body-md text-on-surface-variant">
        The price is the sum of every paid block&apos;s price. The client signs a USDC payment for that amount to the
        creator&apos;s wallet and retries with the <span className="font-data-mono text-body-sm">X-Payment</span> header.
        On success it gets the full article, all blocks, with both HTML and clean plaintext:
      </p>
      <Code lang="json">{`{
  "creatorId": "…",
  "creatorName": "Ada Lovelace",
  "postId": "…",
  "title": "On Analytical Engines",
  "canonicalUrl": "https://<deployment>/read/on-analytical-engines",
  "publishedAt": "2026-06-25T10:00:00.000Z",
  "wordCount": 1820,
  "blocks": [
    { "index": 0, "isFree": true,  "contentHtml": "<p>…</p>", "contentText": "…", "wordCount": 96 },
    { "index": 1, "isFree": false, "contentHtml": "<p>…</p>", "contentText": "…", "wordCount": 240 }
  ],
  "settledAt": "2026-06-25T12:00:01.000Z",
  "creatorWalletAddress": "0x…"
}`}</Code>
      <p className="font-body-sm text-on-surface-variant">
        Worked example, agent-side (simulate-friendly):
      </p>
      <Code lang="typescript">{`const url = \`\${base}/api/articles/\${postId}/full-content\`;

let res = await fetch(url);
if (res.status === 402) {
  const amount = res.headers.get("X-Payment-Amount");      // e.g. "0.100000"
  const payTo  = res.headers.get("X-Payment-Address");     // the creator's wallet
  const xPayment = await signUsdcPayment({ amount, payTo }); // EIP-3009 via Circle Gateway
  res = await fetch(url, { headers: { "X-Payment": xPayment } });
}
const article = await res.json();   // { title, blocks: [...], creatorWalletAddress, ... }`}</Code>
      <p className="font-body-sm text-on-surface-variant">
        If a creator hasn&apos;t set up a payout wallet yet, the endpoint returns{" "}
        <span className="font-data-mono text-body-sm">503</span> rather than ever falling back to a platform address.
        Every request is logged (time, post, amount, paid/unpaid) so you can see programmatic demand for your work.
      </p>

      {/* ───────────────────────── RSS ───────────────────────── */}
      <H2 id="rss">RSS feeds &amp; Folo</H2>

      <div className="mt-stack-md rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="font-label-lg text-label-lg">New to RSS? Here&apos;s the whole idea</div>
        <p className="mt-1 font-body-md text-on-surface-variant">
          RSS is a <strong>universal &ldquo;subscribe&rdquo; button</strong>. A reader adds your feed link to a reader
          app once; from then on, every post you publish shows up there automatically — no algorithm deciding who sees
          it, nobody having to remember to check your page. It&apos;s the same idea as subscribing to a{" "}
          <strong>podcast</strong>, but for your writing. You don&apos;t create or maintain anything — Skimflow builds the
          feed for you and keeps it up to date. A &ldquo;feed&rdquo; is just a web address ending in{" "}
          <span className="font-data-mono text-body-sm">.xml</span> that lists your recent posts in a format every reader
          app understands.
        </p>
      </div>

      <p className="mt-stack-md font-body-md text-on-surface-variant">
        Every creator has a standards-compliant RSS 2.0 feed, so readers can follow you in any RSS app — Feedly,
        Inoreader, or AI-native readers like{" "}
        <a href="https://folo.is" className="text-primary" target="_blank" rel="noreferrer">Folo</a>. Paid posts appear as
        a free teaser plus a link to read the rest on Skimflow, so nothing paid ever leaks into the feed.
      </p>

      <div className="mt-stack-md rounded-xl border border-outline-variant bg-surface-container-low p-4">
        <div className="font-label-lg text-label-lg">See your own feed in 10 seconds</div>
        <ol className="mt-1 list-decimal space-y-1 pl-5 font-body-sm text-on-surface-variant">
          <li>
            Open your feed link in a browser:{" "}
            <span className="font-data-mono text-body-sm">https://&lt;deployment&gt;/api/creators/@you/feed.xml</span>{" "}
            (or tap the <strong>RSS</strong> button on your profile).
          </li>
          <li>You&apos;ll see a page of XML — one <span className="font-data-mono text-body-sm">&lt;item&gt;</span> block per post, each with a title, link, and date.</li>
          <li>If your latest posts are listed, it&apos;s working. That raw XML is what reader apps turn into a clean, readable list.</li>
          <li>To preview it the way readers see it, paste the same URL into <a href="https://folo.is" className="text-primary" target="_blank" rel="noreferrer">Folo</a> or Feedly, or into the <a href="https://validator.w3.org/feed/" className="text-primary" target="_blank" rel="noreferrer">W3C Feed Validator</a> to confirm it&apos;s valid.</li>
        </ol>
      </div>
      <Code lang="http">{`GET /api/creators/<idOrHandle>/feed.xml        # RSS 2.0 feed (accepts a UUID or @handle)
GET /api/creators/<idOrHandle>/posts           # the same posts as JSON (?limit=N)`}</Code>
      <p className="font-body-md text-on-surface-variant">
        Both your <Link href="/dashboard" className="text-primary">creator profile</Link> page and every individual post
        page advertise the feed in their HTML <span className="font-data-mono text-body-sm">&lt;head&gt;</span>, so most
        readers auto-detect it the moment you paste a profile or post URL:
      </p>
      <Code lang="html">{`<link rel="alternate" type="application/rss+xml"
      title="Ada Lovelace on Skimflow"
      href="https://<deployment>/api/creators/<id>/feed.xml" />`}</Code>
      <p className="font-body-sm text-on-surface-variant">
        Your <Link href="/dashboard" className="text-primary">profile</Link> header has an <strong>RSS</strong> button that
        points straight at this feed — copy that URL and share it anywhere readers subscribe. The feed accepts your{" "}
        <span className="font-data-mono text-body-sm">@handle</span> as well as your id, so a clean{" "}
        <span className="font-data-mono text-body-sm">/api/creators/@you/feed.xml</span> works too.
      </p>

      <H2 id="rss-radar">RSSHub Radar &amp; the RSSHub route</H2>
      <p className="font-body-md text-on-surface-variant">
        Because the feed link is server-rendered into the page source, the{" "}
        <a href="https://github.com/DIYgod/RSSHub-Radar" className="text-primary" target="_blank" rel="noreferrer">RSSHub Radar</a>{" "}
        browser extension lights up on any creator or post page, one click to subscribe. Skimflow also ships a native{" "}
        <a href="https://docs.rsshub.app" className="text-primary" target="_blank" rel="noreferrer">RSSHub</a> route for
        installs that prefer it:
      </p>
      <Code lang="text">{`/skimflow/creator/:creatorId      # ?limit=N supported`}</Code>
      <p className="font-body-sm text-on-surface-variant">
        The route maps the public posts API into RSSHub items (free posts full, paid posts teaser-only) and lives
        outside the web app so it never touches the build. Drop a creator profile or post URL into Folo or RSSHub Radar
        and you&apos;re subscribed.
      </p>

      {/* ─────────────────── Grow distribution ─────────────────── */}
      <H2 id="distribution">Grow your distribution</H2>
      <p className="font-body-md text-on-surface-variant">
        These integrations aren&apos;t just plumbing — chained together they let one post reach readers, subscribers, and
        even AI clients without you copy-pasting anywhere. A practical playbook:
      </p>
      <ul className="mt-stack-md grid grid-cols-1 gap-3 md:grid-cols-2">
        {[
          [
            "Publish once, land everywhere",
            "Write in Ghost. On Publish, your newsletter goes out as usual and the same post becomes a pay-per-block page on Skimflow automatically — no double-posting, no migration.",
          ],
          [
            "Syndicate teasers via RSS",
            "Point any RSS-ingesting tool at your feed to auto-repost teasers with a link back: a Discord/Telegram RSS webhook, a Mastodon RSS bot, Zapier / IFTTT / Make, or an email-digest tool. Paid posts only ever expose the free teaser, so syndication drives unlocks instead of giving work away.",
          ],
          [
            "Make yourself subscribe-able",
            "Drop your profile or any post URL into Folo or RSSHub Radar and readers are one click from subscribing — the feed link is server-rendered into every page, so it's auto-detected.",
          ],
          [
            "Let software cite you",
            "The x402 full-content API turns AI agents and research tools into a paying audience — they buy the whole article to quote it, straight to your wallet. A distribution channel humans-only creators can't reach.",
          ],
          [
            "Ride in-app discovery",
            "Every published post surfaces in For You and in your followers' Following feed, and follows, comments, and likes fire notifications that pull readers back. Reply to commenters — engaged threads resurface your work.",
          ],
          [
            "Turn readers into followers",
            "Share your Skimflow profile link (there's a copy button on your profile). A follow means your next post lands at the top of someone's Following feed — compounding reach with every piece.",
          ],
        ].map(([title, body]) => (
          <li key={title} className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
            <div className="font-label-lg text-label-lg">{title}</div>
            <p className="mt-1 font-body-sm text-on-surface-variant">{body}</p>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-stack-lg rounded-xl border border-outline-variant bg-surface-container-low p-stack-lg text-center">
        <h3 className="font-headline-sm text-headline-sm">Connect your first integration</h3>
        <p className="mb-stack-md font-body-md text-on-surface-variant">Link Ghost in Settings, or grab your feed URL from your profile.</p>
        <div className="flex justify-center gap-gutter">
          <Link href="/dashboard/settings" className="btn-primary px-8 py-3">Open Settings → Integrations</Link>
          <Link href="/docs" className="btn-outline px-8 py-3">Back to Using Skimflow</Link>
        </div>
      </div>
    </div>
  );
}
