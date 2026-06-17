// Primary: the agent-skills 402 → pay → unlock consumer (chunk system).
export { runAgentSkills } from "./agent-skills-client.js";
export type {
  AgentSkillsOptions,
  AgentSkillsResult,
  BlockTrace,
} from "./agent-skills-client.js";

// Legacy: the original line-based research flow. The line-based endpoints it
// drove (/api/catalog, /api/content/:id) were removed in the chunk migration,
// so these are retained for reference only and are no longer wired to the app.
export { runResearch } from "./agent.js";
export type { ResearchResult, AgentStep, Citation, RunOptions } from "./agent.js";
export { X402Client } from "./x402-client.js";
