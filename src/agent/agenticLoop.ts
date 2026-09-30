import { type LanguageModel, type ModelMessage, type ToolSet, stepCountIs, streamText } from "ai";

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  description: string;
  diffText: string | null;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

export interface RunTurnResult {
  text: string;
  messages: ModelMessage[];
}

const DEFAULT_MAX_ROUNDS = 20;

export interface AgenticLoopParams {
  model: LanguageModel;
  systemPrompt: string;
  tools: ToolSet;
  toolApproval: Partial<Record<string, "user-approval">>;
  messages: ModelMessage[];
  onApprovalRequest: (approval: PendingApproval) => Promise<ApprovalDecision>;
  /** Called with each chunk of assistant text as it streams in, in order. */
  onTextDelta?: (delta: string) => void;
  /** Called the moment the model starts generating a tool call's arguments. */
  onToolCallStart?: (toolName: string) => void;
  /** Builds the diff/description shown in the approval prompt for a given tool call. */
  buildApprovalDescription: (
    toolName: string,
    input: Record<string, unknown>,
  ) => { description: string; diffText: string } | null;
  /**
   * Called for every approval request before it would otherwise reach the human. Return a
   * rejection reason (fed back to the model) to auto-reject without ever showing the prompt, or
   * null/undefined to let it proceed to onApprovalRequest as normal.
   */
  shouldAutoReject?: (toolName: string) => string | null | undefined;
  maxRounds?: number;
}

/**
 * A bounded, approval-aware agentic loop: streams the model's response, intercepts any
 * user-approval-gated tool calls (auto-rejecting ones that fail `shouldAutoReject`, otherwise
 * routing them through `onApprovalRequest`), feeds the responses back, and repeats until the
 * model stops calling tools or `maxRounds` is hit. Shared by the main turn loop (`runTurn` in
 * loop.ts) and any nested sub-agent (e.g. the draft-chapter agent), so both get the same
 * approval semantics without duplicating this control flow.
 */
export async function runAgenticLoop(params: AgenticLoopParams): Promise<RunTurnResult> {
  let messages = params.messages;
  let combinedText = "";
  const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;

  for (let round = 0; round < maxRounds; round++) {
    const result = streamText({
      model: params.model,
      system: params.systemPrompt,
      messages,
      tools: params.tools,
      toolApproval: params.toolApproval,
      stopWhen: stepCountIs(8),
    });

    const approvalRequests: Array<{ approvalId: string; toolCall: { toolName: string; input: unknown } }> = [];

    for await (const part of result.stream) {
      if (part.type === "text-start") {
        // Each text block (e.g. before/after a tool call) streams independently and rarely
        // starts with its own leading space, so without this two sentences from different
        // blocks can run together with no space between them.
        if (combinedText.length > 0 && !/\s$/.test(combinedText)) {
          const separator = "\n\n";
          combinedText += separator;
          params.onTextDelta?.(separator);
        }
      } else if (part.type === "text-delta") {
        combinedText += part.text;
        params.onTextDelta?.(part.text);
      } else if (part.type === "tool-input-start") {
        params.onToolCallStart?.(part.toolName);
      } else if (part.type === "tool-approval-request" && !part.isAutomatic) {
        approvalRequests.push(part);
      }
    }

    messages = [...messages, ...(await result.responseMessages)];

    if (approvalRequests.length === 0) {
      return { text: combinedText, messages };
    }

    const responses = [];
    for (const req of approvalRequests) {
      const { toolName, input } = req.toolCall;

      // Refuse before the human ever sees it, not just before executing: the diff below is
      // built straight from the model's raw tool-call input, so a premature call still produces
      // a (bogus) approval prompt unless we intercept it here.
      const autoRejectReason = params.shouldAutoReject?.(toolName);
      if (autoRejectReason) {
        responses.push({
          type: "tool-approval-response" as const,
          approvalId: req.approvalId,
          approved: false,
          reason: autoRejectReason,
        });
        continue;
      }

      const diff = params.buildApprovalDescription(toolName, (input ?? {}) as Record<string, unknown>);
      const decision = await params.onApprovalRequest({
        approvalId: req.approvalId,
        toolName,
        description: diff?.description ?? toolName,
        diffText: diff?.diffText ?? null,
      });
      responses.push({
        type: "tool-approval-response" as const,
        approvalId: req.approvalId,
        approved: decision.approved,
        reason: decision.reason,
      });
    }
    messages = [...messages, { role: "tool", content: responses }];
  }

  return { text: combinedText || "(stopped: too many tool-approval rounds without resolution)", messages };
}
