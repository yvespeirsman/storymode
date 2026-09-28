import { Text } from "ink";

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

// Matches **bold**, `code`, then *italic*/_italic_ (not preceded/followed by another
// asterisk, so it doesn't fire inside an already-matched **bold** span). No `s` flag, so a
// span can't accidentally swallow a paragraph break if the model forgets a closing marker.
const INLINE_MARKDOWN_RE = /\*\*(.+?)\*\*|`(.+?)`|(?<!\*)\*([^*\n]+?)\*(?!\*)|\b_([^_\n]+?)_\b/g;

function parseInlineMarkdown(source: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of source.matchAll(INLINE_MARKDOWN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: source.slice(lastIndex, index) });
    const [, bold, code, italicStar, italicUnderscore] = match;
    if (bold !== undefined) segments.push({ text: bold, bold: true });
    else if (code !== undefined) segments.push({ text: code, code: true });
    else if (italicStar !== undefined) segments.push({ text: italicStar, italic: true });
    else if (italicUnderscore !== undefined) segments.push({ text: italicUnderscore, italic: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < source.length) segments.push({ text: source.slice(lastIndex) });
  return segments;
}

/** Renders a string with inline markdown (bold, italic, inline code) styled in the terminal. */
export function MarkdownText({ children, dimColor }: { children: string; dimColor?: boolean }) {
  const segments = parseInlineMarkdown(children);
  return (
    <Text dimColor={dimColor}>
      {segments.map((segment, i) => (
        <Text key={i} bold={segment.bold} italic={segment.italic} color={segment.code ? "cyan" : undefined}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}
