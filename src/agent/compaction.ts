import { type LanguageModel, type ModelMessage, generateText } from "ai";

/** Once a session's history exceeds this many messages, the oldest stretch gets summarized. */
const COMPACTION_MESSAGE_THRESHOLD = 40;
/** How many of the most recent messages are always kept verbatim, never summarized. */
const COMPACTION_KEEP_RECENT = 12;

export interface CompactionResult {
  messages: ModelMessage[];
  compacted: boolean;
  summarizedCount: number;
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => ("text" in part ? part.text : ""))
    .filter(Boolean)
    .join(" ");
}

/**
 * Finds the earliest safe cut point at or after `messages.length - keepRecent`: the next `user`
 * message, since a turn always starts with one. Cutting anywhere else risks separating a tool
 * call from its result, which most providers reject as an invalid message sequence. Returns null
 * if no such message exists in range (the tail is one long turn) — better to skip compaction this
 * round than risk corrupting the sequence.
 */
function findSafeSplitIndex(messages: ModelMessage[], keepRecent: number): number | null {
  const minIndex = Math.max(0, messages.length - keepRecent);
  for (let i = minIndex; i < messages.length; i++) {
    if (messages[i]?.role === "user") return i;
  }
  return null;
}

/**
 * Once a session's message history grows past a threshold, summarizes everything except the most
 * recent stretch into a single synthetic message, so requests don't keep resending an
 * ever-growing transcript. Runs once per turn, on the history carried in from prior turns — never
 * on the turn's own in-progress tool-call rounds, so a cut can't land mid-tool-call.
 */
export async function compactMessages(model: LanguageModel, messages: ModelMessage[]): Promise<CompactionResult> {
  if (messages.length <= COMPACTION_MESSAGE_THRESHOLD) {
    return { messages, compacted: false, summarizedCount: 0 };
  }

  const splitIndex = findSafeSplitIndex(messages, COMPACTION_KEEP_RECENT);
  if (splitIndex === null || splitIndex === 0) {
    return { messages, compacted: false, summarizedCount: 0 };
  }

  const older = messages.slice(0, splitIndex);
  const recent = messages.slice(splitIndex);

  const transcript = older
    .filter((m) => (m.role === "user" || m.role === "assistant") && messageText(m).trim().length > 0)
    .map((m) => `${m.role}: ${messageText(m)}`)
    .join("\n\n");

  if (!transcript.trim()) {
    return { messages, compacted: false, summarizedCount: 0 };
  }

  try {
    const { text } = await generateText({
      model,
      prompt:
        "Summarize this fiction-writing session's earlier conversation in a short, dense paragraph " +
        "(under 200 words). Cover what the writer asked for, what was decided or drafted, and any " +
        "open questions or next steps. Don't editorialize — just the facts a collaborator would need " +
        "to pick the conversation back up.\n\n" +
        transcript,
    });

    const summaryMessage: ModelMessage = {
      role: "user",
      content: `[Summary of earlier conversation, compacted to save context]\n\n${text.trim()}`,
    };

    return { messages: [summaryMessage, ...recent], compacted: true, summarizedCount: older.length };
  } catch {
    // Compaction is a context-management optimization, not a stability requirement — if the
    // summarization call fails for any reason, just carry on with the uncompacted history.
    return { messages, compacted: false, summarizedCount: 0 };
  }
}
