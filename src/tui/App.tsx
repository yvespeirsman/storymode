import { type ModelMessage } from "ai";
import { Box, Text, useApp, useInput } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { type AgentLoopDeps, type ApprovalDecision, type PendingApproval, runTurn } from "../agent/loop.js";
import { ORIENTATION_PROMPT } from "../agent/onboarding.js";
import { saveSession, type SessionData } from "../agent/session.js";
import { DiffView } from "./DiffView.js";

interface DisplayMessage {
  role: "user" | "assistant" | "status" | "error";
  text: string;
}

export interface AppProps {
  deps: Omit<AgentLoopDeps, "onApprovalRequest">;
  session: SessionData;
  projectDir: string;
}

function textFromMessage(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => ("text" in part ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function App({ deps, session, projectDir }: AppProps) {
  const { exit } = useApp();
  const [log, setLog] = useState<DisplayMessage[]>(() =>
    session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", text: textFromMessage(m) }))
      .filter((m) => m.text.trim().length > 0),
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const sessionRef = useRef(session);
  const approvalResolveRef = useRef<((decision: ApprovalDecision) => void) | null>(null);

  const handleApprovalRequest = useCallback((approval: PendingApproval): Promise<ApprovalDecision> => {
    setPendingApproval(approval);
    return new Promise((resolve) => {
      approvalResolveRef.current = resolve;
    });
  }, []);

  const submit = useCallback(
    async (text: string, opts: { display?: boolean } = {}) => {
      const display = opts.display ?? true;
      if (display) setLog((prev) => [...prev, { role: "user", text }]);
      setBusy(true);
      setStreamingText("");
      try {
        const result = await runTurn(
          {
            ...deps,
            onApprovalRequest: handleApprovalRequest,
            onTextDelta: (delta) => setStreamingText((prev) => (prev ?? "") + delta),
          },
          sessionRef.current.messages,
          text,
        );
        sessionRef.current = { ...sessionRef.current, messages: result.messages };
        saveSession(projectDir, sessionRef.current);
        setLog((prev) => [...prev, { role: "assistant", text: result.text || "(no response)" }]);
      } catch (err) {
        setLog((prev) => [...prev, { role: "error", text: err instanceof Error ? err.message : String(err) }]);
      } finally {
        setStreamingText(null);
        setBusy(false);
      }
    },
    [deps, handleApprovalRequest, projectDir],
  );

  // Brand-new session (no prior messages): orient the writer instead of a blank prompt.
  useEffect(() => {
    if (sessionRef.current.messages.length === 0) {
      void submit(ORIENTATION_PROMPT, { display: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((char, key) => {
    if (pendingApproval) {
      if (char.toLowerCase() === "y" || key.return) {
        approvalResolveRef.current?.({ approved: true });
        approvalResolveRef.current = null;
        setPendingApproval(null);
      } else if (char.toLowerCase() === "n" || key.escape) {
        approvalResolveRef.current?.({ approved: false, reason: "User rejected this edit." });
        approvalResolveRef.current = null;
        setPendingApproval(null);
      }
      return;
    }

    if (busy) return;

    if (key.return) {
      const text = input.trim();
      setInput("");
      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }
      if (text.length > 0) void submit(text);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }
    if (key.ctrl && char === "c") {
      exit();
      return;
    }
    if (!key.ctrl && !key.meta && char) {
      setInput((prev) => prev + char);
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {log.map((entry, i) => (
          <Box key={i} marginBottom={1} flexDirection="column">
            <Text bold color={entry.role === "user" ? "cyan" : entry.role === "error" ? "red" : "green"}>
              {entry.role === "user" ? "you" : entry.role === "error" ? "error" : "storymode"}
            </Text>
            <Text>{entry.text}</Text>
          </Box>
        ))}
        {streamingText !== null && (
          <Box marginBottom={1} flexDirection="column">
            <Text bold color="green">
              storymode
            </Text>
            <Text>
              {streamingText}
              {streamingText.length === 0 ? "[thinking…]" : <Text dimColor>▌</Text>}
            </Text>
          </Box>
        )}
      </Box>

      {pendingApproval && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">
            Approval needed: {pendingApproval.description}
          </Text>
          {pendingApproval.diffText && <DiffView diffText={pendingApproval.diffText} />}
          <Text dimColor>Press [y] to approve, [n] to reject.</Text>
        </Box>
      )}

      {!pendingApproval && (
        <Box>
          <Text color={busy ? "gray" : "cyan"}>{busy ? "…" : ">"} </Text>
          <Text>{input}</Text>
          {!busy && <Text dimColor>█</Text>}
        </Box>
      )}
    </Box>
  );
}
