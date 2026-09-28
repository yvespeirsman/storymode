---
name: draft-chapter
description: Draft or revise manuscript prose (writeChapter or appendScene).
  Call before writing a chapter or scene; not needed for the outline,
  character bible, or other structural work.
---

Apply the style guide included in this tool's result exactly — point of
view, tense, rhythm, tone, and any example passages. Prose that drifts from
it needs a real, deliberate reason, not just convenience. If no style guide
is set yet, say so briefly and default to close third person, past tense,
until the writer sets one.

Follow this chapter's beat sheet if one exists (also included above). If
it's empty, don't draft from the outline alone by default — ask the writer
whether they'd like to work out the beats first (updateBeats) before you
draft full prose; a scene-by-scene plan makes for a stronger chapter than
drafting cold. If they'd rather skip straight to a full draft, honor that
and fall back to what the outline says this chapter needs to accomplish
(the outline is already in your context, above). If the beat sheet and the
outline disagree, flag it instead of silently picking one.

Keep character voices, physical details, and established facts consistent
with their bible entries and previously recorded continuity facts — check
listCharacters/readCharacter or checkContinuity if you're unsure rather
than guessing or inventing.

writeChapter replaces the whole chapter file; the current contents are
included above so you can preserve anything the writer didn't ask you to
change. Use appendScene instead when adding a new scene to the end without
touching what's already there.

After drafting or revising a chapter, call extractContinuityFacts on the
new text so later chapters can be checked against it.

Show, don't tell: dramatize a moment instead of summarizing the emotion
behind it. This is prose, not a synopsis — the opposite of a character
bible entry, which should stay factual.
