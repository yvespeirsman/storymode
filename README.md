# StoryMode: your Claude Code for Fiction

StoryMode is an agentic writing harness for fiction. It takes its inspiration from
coding agents like Claude Code, OpenCode and pi.dev, and applies it to novels instead
of codebases. Run it inside a project folder with markdown files, and it reads
and edits those files through an AI agent that keeps your outline, character
bible, and manuscript in sync as you go.

StoryMode structures the writing process as a collaboration between man and machine. 
When you start StoryMode, the program
will scan your project directory, determine the status of your novel, and suggest
what to do next.
The AI agent helps you create an outline, characters, chapters, etc., but does not make
any changes to your work without your approval. 

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

The API key stored once, globally, at `~/.config/storymode/config.json`, so that every project on your machine can use it. 

To use OpenAI instead of Anthropic, run:

```
storymode config set-key openai sk-...
storymode config set-default openai gpt-5
```

You can also use environment variables (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`)
if you'd rather not save a key to disk.

## Quick start

```
mkdir my-novel && cd my-novel
storymode init --title "The Salt Road"
storymode
```

`init` sets up an empty project (see [Project layout](#project-layout)
below). Running `storymode` with no argument then launches an interactive
session. StoryMode checks what's already in your project directory (outline,
characters, chapters) and opens with a short orientation message suggesting what to do next:
sketch the premise, build out your cast, or start drafting, if you already
have enough to go on.

From there you can chat with the AI agent to draft your story:

```
> Let's outline a three-act structure. It's a heist story set on a
  smuggler's ship in a flooded city.

> Give Mira Solenne a backstory — she used to work for the people she's
  now stealing from.

> Draft the opening scene of chapter 1 from Mira's point of view.
```

## The approval flow

Any time the agent wants to change a file on disk (write or append to a
chapter, update the outline or a beat sheet, add or edit a character/location) 
it stops and shows you what it would like to change:

```
Approval needed: Write chapter "ch01"
─────────────────────────────────────
+ Mira had never liked the smell of the harbor at dawn.
─────────────────────────────────────
Press [y] to approve, [n] to reject.
```

Press `y` to accept, `n` to reject the suggestion. 

The model in use is shown at the top of the session. Run `/model list` to
fetch the models available for your current provider from its API (or
`/model list openai` / `/model list anthropic` for a specific one). Switch
model at any time with `/model <provider> <model>`, e.g. `/model openai
gpt-5` — this checks the model exists for that provider before switching,
and saves the choice to `.storymode/config.json` so it's remembered for
next time. Run `/model` with no arguments to see the current model. Typing
`/` on its own shows a list of all slash commands.

Type `/exit` or `/quit`, or press `Ctrl+C`, to leave a session at any time.
Come back to it later with:

```
storymode continue
```

This resumes the most recent session in the current project instead of
starting a new one.

## Project layout

`storymode init` creates this structure in the current directory:

```
my-novel/
  .storymode/
    config.json              # this project's title and model settings
    style.md                  # style guide: description and/or example passages
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
| `storymode style show` | Print the style guide |
| `storymode style edit` | Open the style guide in `$EDITOR` |
| `storymode continuity check <chapterId>` | Check a chapter against previously recorded facts |
| `storymode continuity facts` | List all recorded continuity facts |
| `storymode export [-o path]` | Compile the manuscript into a single markdown file |
| `storymode config show` | Print the current global config |
| `storymode config set-key <provider> <key>` | Store an API key |
| `storymode config set-default <provider> <model>` | Set the default provider/model |

Run any command with `--help` for its full options.

## Style guide

`.storymode/style.md` is a project-specific markdown file where you can
describe the voice you want (point of view, tense, sentence rhythm, tone) and/or
paste in example passages to imitate. The agent reads it in full before every
turn and tries to match it. Edit it by hand or with `storymode style edit`.

## Continuity checking

As you draft chapters, ask the agent to run `extractContinuityFacts` (or just
ask it to "remember what's established here") to pull out atomic facts —
traits, dates, relationships, places — into `.storymode/continuity/facts.jsonl`.
Later, `storymode continuity check <chapterId>` (or asking the agent to check
continuity) compares new text against everything recorded so far and flags
contradictions, e.g. a character's eye color changing between chapters.

## Notes

- StoryMode never sends anything anywhere except your chosen model provider's
  API. No other backend is involved.
- Bring your own model: StoryMode works with any Anthropic or OpenAI model
  you have access to; set it with `storymode config set-default <provider> <model>`
  or per-project in `.storymode/config.json`.
