import { type LanguageModel, type ModelMessage } from "ai";
import { Box, Text, useApp, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AgentLoopDeps, type ApprovalDecision, type PendingApproval, runTurn } from "../agent/loop.js";
import { ORIENTATION_PROMPT } from "../agent/onboarding.js";
import { saveSession, type SessionData } from "../agent/session.js";
import { listModels, modelExists, resolveLanguageModel } from "../agent/providers.js";
import { resolveApiKeyForProvider, resolveConfig, saveProjectConfig } from "../project/config.js";
import { providerIdSchema, type ProjectConfig } from "../project/schema.js";
import { DiffView } from "./DiffView.js";

interface DisplayMessage {
  role: "user" | "assistant" | "status" | "error";
  text: string;
}

interface SlashCommand {
  name: string;
  usage: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/model",
    usage: "/model [list [<provider>] | <provider> <model>]",
    description: "Show the active model, list available models, or switch model",
  },
  { name: "/help", usage: "/help", description: "List available commands" },
  { name: "/exit", usage: "/exit", description: "Leave the session" },
  { name: "/quit", usage: "/quit", description: "Leave the session (alias of /exit)" },
];

const MODEL_USAGE_TEXT =
  "Usage:\n  /model — show current model\n  /model list [<provider>] — list available models\n  /model <provider> <model> — switch model  (providers: anthropic, openai)";

const SLASH_COMMANDS_HELP_TEXT = SLASH_COMMANDS.map((c) => `${c.usage} — ${c.description}`).join("\n");

const ASCII_LOGO_STORY = [
  "████  █                ",
  "█▄▄▄ ▀█▀▀ █▀▀█ █▀▀ █  █",
  "   █  █   █  █ █   ▀▄▄▀",
  "████  ▀▀  ▀▀▀▀ ▀    ██ ",
].join("\n");

const ASCII_LOGO_MODE = [
  "█▄ ▄█         ▄     ",
  "█ █ █ █▀▀█ █▀▀█ █▀▀█",
  "█   █ █  █ █  █ █▀▀▀",
  "█   █ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
].join("\n");

export interface AppProps {
  deps: Omit<AgentLoopDeps, "onApprovalRequest">;
  session: SessionData;
  projectDir: string;
  modelLabel: string;
}

function textFromMessage(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => ("text" in part ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function App({ deps, session, projectDir, modelLabel: initialModelLabel }: AppProps) {
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
  const [currentModel, setCurrentModel] = useState<LanguageModel>(deps.model);
  const [currentProject, setCurrentProject] = useState<ProjectConfig>(deps.project);
  const [modelLabel, setModelLabel] = useState(initialModelLabel);
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
            model: currentModel,
            projectDir,
            project: currentProject,
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
    [currentModel, currentProject, handleApprovalRequest, projectDir],
  );

  const handleModelListCommand = useCallback(
    async (providerArg: string | undefined) => {
      const parsedProvider = providerArg
        ? providerIdSchema.safeParse(providerArg)
        : providerIdSchema.safeParse(modelLabel.split("/")[0]);
      if (!parsedProvider.success) {
        setLog((prev) => [
          ...prev,
          { role: "error", text: `Unknown provider "${providerArg}". Use "anthropic" or "openai".` },
        ]);
        return;
      }
      const apiKey = resolveApiKeyForProvider(parsedProvider.data);
      if (!apiKey) {
        setLog((prev) => [
          ...prev,
          {
            role: "error",
            text: `No API key found for provider "${parsedProvider.data}". Set one with \`storymode config set-key ${parsedProvider.data} <key>\`.`,
          },
        ]);
        return;
      }
      setBusy(true);
      try {
        const models = await listModels(parsedProvider.data, apiKey);
        const listText = models.length > 0 ? models.map((m) => m.id).sort().join("\n") : "(no models returned)";
        setLog((prev) => [...prev, { role: "status", text: `Available ${parsedProvider.data} models:\n${listText}` }]);
      } catch (err) {
        setLog((prev) => [...prev, { role: "error", text: err instanceof Error ? err.message : String(err) }]);
      } finally {
        setBusy(false);
      }
    },
    [modelLabel],
  );

  const handleModelSwitchCommand = useCallback(
    async (providerRaw: string, modelId: string) => {
      const parsedProvider = providerIdSchema.safeParse(providerRaw);
      if (!parsedProvider.success) {
        setLog((prev) => [
          ...prev,
          { role: "error", text: `Unknown provider "${providerRaw}". Use "anthropic" or "openai".` },
        ]);
        return;
      }
      const apiKey = resolveApiKeyForProvider(parsedProvider.data);
      if (!apiKey) {
        setLog((prev) => [
          ...prev,
          {
            role: "error",
            text: `No API key found for provider "${parsedProvider.data}". Set one with \`storymode config set-key ${parsedProvider.data} <key>\`.`,
          },
        ]);
        return;
      }

      setBusy(true);
      try {
        const exists = await modelExists(parsedProvider.data, apiKey, modelId);
        if (!exists) {
          setLog((prev) => [
            ...prev,
            {
              role: "error",
              text: `Model "${modelId}" was not found for provider "${parsedProvider.data}". Run \`/model list ${parsedProvider.data}\` to see available models.`,
            },
          ]);
          return;
        }
      } catch (err) {
        setLog((prev) => [
          ...prev,
          {
            role: "status",
            text: `Could not verify model "${modelId}" (${err instanceof Error ? err.message : String(err)}) — switching anyway.`,
          },
        ]);
      } finally {
        setBusy(false);
      }

      try {
        saveProjectConfig(projectDir, { ...currentProject, provider: parsedProvider.data, model: modelId });
        const resolved = resolveConfig(projectDir);
        setCurrentModel(resolveLanguageModel(resolved));
        setCurrentProject(resolved.project);
        setModelLabel(`${resolved.provider}/${resolved.model}`);
        setLog((prev) => [...prev, { role: "status", text: `Switched model to ${resolved.provider}/${resolved.model}.` }]);
      } catch (err) {
        setLog((prev) => [...prev, { role: "error", text: err instanceof Error ? err.message : String(err) }]);
      }
    },
    [currentProject, projectDir],
  );

  const handleModelCommand = useCallback(
    (text: string) => {
      const args = text.split(/\s+/).slice(1);

      if (args.length === 0) {
        setLog((prev) => [...prev, { role: "status", text: `Current model: ${modelLabel}\n${MODEL_USAGE_TEXT}` }]);
        return;
      }

      if (args[0] === "list") {
        void handleModelListCommand(args[1]);
        return;
      }

      const [providerRaw, modelId] = args;
      if (args.length !== 2 || !providerRaw || !modelId) {
        setLog((prev) => [...prev, { role: "status", text: MODEL_USAGE_TEXT }]);
        return;
      }

      void handleModelSwitchCommand(providerRaw, modelId);
    },
    [handleModelListCommand, handleModelSwitchCommand, modelLabel],
  );

  const matchingCommands = useMemo(() => {
    if (!input.startsWith("/")) return null;
    return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(input));
  }, [input]);

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
      if (text === "/model" || text.startsWith("/model ")) {
        handleModelCommand(text);
        return;
      }
      if (text === "/help") {
        setLog((prev) => [...prev, { role: "status", text: `Available commands:\n${SLASH_COMMANDS_HELP_TEXT}` }]);
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
        <Box>
          <Box marginRight={1}>
            <Text dimColor>{ASCII_LOGO_STORY}</Text>
          </Box>
          <Text bold>{ASCII_LOGO_MODE}</Text>
        </Box>
        <Text dimColor>model: {modelLabel}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {log.map((entry, i) => (
          <Box key={i} marginBottom={1} flexDirection="column">
            <Text
              bold
              color={
                entry.role === "user"
                  ? "cyan"
                  : entry.role === "error"
                    ? "red"
                    : entry.role === "status"
                      ? "yellow"
                      : "green"
              }
            >
              {entry.role === "user"
                ? "you"
                : entry.role === "error"
                  ? "error"
                  : entry.role === "status"
                    ? "system"
                    : "storymode"}
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

      {!pendingApproval && !busy && matchingCommands && (
        <Box flexDirection="column" marginTop={1}>
          {matchingCommands.length > 0 ? (
            matchingCommands.map((cmd) => (
              <Text key={cmd.name} dimColor>
                {cmd.usage} — {cmd.description}
              </Text>
            ))
          ) : (
            <Text dimColor>No matching commands.</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
