/**
 * Sent as the first turn of any brand-new session (no prior messages) so the
 * agent orients the writer instead of dropping them at a blank prompt.
 */
export const ORIENTATION_PROMPT = `This is the start of a new session in this project. Before saying anything else:

1. Check whether the outline (given above in your context, if present) is filled in or still just the empty template.
2. Call listCharacters and listChapters to see what's already been built.

Then write a short, friendly orientation message (under ~150 words) that:
- Briefly states what's already in place, or that the project is still empty.
- Recommends one concrete next step: collaborating on the premise/outline, fleshing out main
  characters, or jumping straight into drafting a chapter if there's already enough groundwork to
  write from.
- Ends with a direct, open question inviting the writer to pick a direction or say what they'd
  rather do instead.

Do not make any edits yet — this is purely an orientation message, not a drafting turn.`;
