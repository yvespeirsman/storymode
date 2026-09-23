# StoryMode

A terminal, agentic writing harness for fiction — the same idea as a coding
agent CLI (OpenCode, pi.dev), but pointed at a novel instead of a codebase.
You run it inside a project folder full of plain markdown files, and it reads
and edits those files through an AI agent that keeps your outline, character
bible, and manuscript in sync as you go.

Every file the agent wants to write — a chapter, a character bio, the outline
— is shown to you as a diff first. Nothing lands until you approve it.

## Requirements

- Node.js 20+
- An API key for at least one supported provider: [Anthropic](https://console.anthropic.com/) or [OpenAI](https://platform.openai.com/)

## Install

```
npm install
npm run build
npm link          # makes the `storymode` command available globally
```

## Set up your API key

```
storymode config set-key anthropic sk-ant-...
```

This is stored once, globally, at `~/.config/storymode/config.json` — every
project on your machine uses it. You can use OpenAI instead:

```
storymode config set-key openai sk-...
storymode config set-default openai gpt-5
```

An environment variable (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) always wins
over the stored config, if you'd rather not save a key to disk.

## Quick start

```
mkdir my-novel && cd my-novel
storymode init --title "The Salt Road"
storymode
```

`init` scaffolds an empty project (see [Project layout](#project-layout)
below). Running `storymode` with no arguments launches an interactive
session. Because this is a brand-new project, StoryMode won't just show you a
blank prompt — it checks what's already there (outline, characters, chapters)
and opens with a short orientation message suggesting what to do first:
sketch the premise, build out your cast, or start drafting, if you already
have enough to go on.

From there it's a conversation. Talk to it like a collaborator:

```
> Let's outline a three-act structure. It's a heist story set on a
  smuggler's ship in a flooded city.

> Give Mira Solenne a backstory — she used to work for the people she's
  now stealing from.

> Draft the opening scene of chapter 1 from Mira's point of view.
```

## The approval flow

Any time the agent wants to change a file on disk — write or append to a
chapter, update the outline or a beat sheet, add or edit a character/location
— it stops and shows you a unified diff:

```
Approval needed: Write chapter "ch01"
─────────────────────────────────────
+ Mira had never liked the smell of the harbor at dawn.
─────────────────────────────────────
Press [y] to approve, [n] to reject.
```

Press `y` to let it through, `n` to reject it (the agent is told you rejected
it and can try a different approach). Read-only actions — reading a chapter,
listing characters, checking continuity — happen without asking, since
they can't change anything.

Type `/exit` or `/quit`, or press `Ctrl+C`, to leave a session at any time.
Come back to it later with:

```
storymode continue
```

which resumes the most recent session in the current project instead of
starting a new one.

## Project layout

`storymode init` creates this structure in the current directory:

```
my-novel/
  .storymode/
    config.json              # this project's title, style guide, model settings
    bible/
      characters/            # one markdown file per character
      locations/              # one markdown file per location
      lore.md                  # world rules, glossary, timeline
    outline/
      outline.md               # top-level plot / act structure
      beats/                    # per-chapter scene beat sheets
    continuity/
      facts.jsonl               # canonical facts extracted from drafted chapters
    session/                    # saved conversation history, for `storymode continue`
  manuscript/
    ch01.md, ch02.md, ...       # your actual prose, one file per chapter
```

Everything is plain markdown with YAML frontmatter where structured data is
useful (characters, locations). You can hand-edit any of these files with
your own editor at any time — StoryMode just reads whatever's there.

## Commands

Most of the day-to-day work happens inside the interactive session, but
everything is also available directly from the shell:

| Command | What it does |
|---|---|
| `storymode init [-t "Title"]` | Scaffold a new project in the current directory |
| `storymode` | Start a new interactive session |
| `storymode continue` | Resume the most recent session |
| `storymode character add "Name" [-r role] [-t traits]` | Add or update a character |
| `storymode character list` | List all characters |
| `storymode character show <slug>` | Print a character's full bible entry |
| `storymode outline show` | Print the outline and list chapters with beat sheets |
| `storymode outline edit` | Open the outline in `$EDITOR` |
| `storymode outline beats <chapterId> [-e]` | Show or edit a chapter's scene beats |
| `storymode continuity check <chapterId>` | Check a chapter against previously recorded facts |
| `storymode continuity facts` | List all recorded continuity facts |
| `storymode export [-o path]` | Compile the manuscript into a single markdown file |
| `storymode config show` | Print the current global config |
| `storymode config set-key <provider> <key>` | Store an API key |
| `storymode config set-default <provider> <model>` | Set the default provider/model |

Run any command with `--help` for its full options.

## Continuity checking

As you draft chapters, ask the agent to run `extractContinuityFacts` (or just
ask it to "remember what's established here") to pull out atomic facts —
traits, dates, relationships, places — into `.storymode/continuity/facts.jsonl`.
Later, `storymode continuity check <chapterId>` (or asking the agent to check
continuity) compares new text against everything recorded so far and flags
contradictions, e.g. a character's eye color changing between chapters.

## Notes

- StoryMode never sends anything anywhere except your chosen model provider's
  API — there's no other backend involved.
- Bring your own model: StoryMode works with any Anthropic or OpenAI model
  you have access to; set it with `storymode config set-default <provider> <model>`
  or per-project in `.storymode/config.json`.
