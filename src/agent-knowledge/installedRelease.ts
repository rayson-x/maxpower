import installedRelease from "./releases/maxpower-planner.v2.json";
import { AgentKnowledgeBackend } from "./AgentKnowledgeBackend";

/**
 * Loads the single Agent Knowledge Release bundled with this client build.
 * Client mode rejects shadow/built candidates and never falls back to Legacy.
 */
export function createInstalledAgentKnowledgeBackend(): AgentKnowledgeBackend {
  return AgentKnowledgeBackend.load(installedRelease, {
    mode: "client_active",
    appSchemaVersion: 1,
  });
}
