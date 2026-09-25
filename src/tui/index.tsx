import { render } from "ink";
import type { AgentLoopDeps } from "../agent/loop.js";
import type { SessionData } from "../agent/session.js";
import { App } from "./App.js";

export async function startTui(
  deps: Omit<AgentLoopDeps, "onApprovalRequest">,
  session: SessionData,
  projectDir: string,
  modelLabel: string,
) {
  const { waitUntilExit } = render(<App deps={deps} session={session} projectDir={projectDir} modelLabel={modelLabel} />);
  await waitUntilExit();
}
