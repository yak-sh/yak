---
name: skill-writing
description: >
  How to write, change, rename, split, merge or review a skill in
  .claude/skills, and how to decide where a piece of knowledge, a workflow or a
  recurring task should live: a skill, the persona, a package README, a code
  comment or a task. Use it whenever you are about to create or edit a SKILL.md
  or a script beside one, write or tune a skill's description, fix a skill that
  fired at the wrong moment or never fired, turn what a session learned about
  an area into something the next agent will know, or find area knowledge
  sitting in a memory, a README or a brief that every agent there needs, even
  when the request only says "document this", "write this down", "so agents
  know how this works" or "make a skill". Anthropic's `skill-creator` covers the
  format; this is the judgment on top. A brief for one agent is
  `agent-briefs`; a proposal for the owner is `design-docs`.
---

# Writing skills

A skill is a folder under `.claude/skills/<name>/`: a SKILL.md, and scripts
beside it when it needs them. Its name and description sit in every agent's
context all the time; the body loads only when the description matches what
the agent is doing. That makes a skill the home for knowledge an agent needs
only in some situations: as much as teaching takes, at no cost until then.

Jeff, verbatim: "for now at least, i really want to lean into skills. for
documentation, workflows, tasks, etc etc." and "skills can also work well just
for documentation. the auto-trigger is kinda what we were searching for with
memories".

A repository skill reaches Claude Code, native harness sessions and agents
connected to the box's MCP server. Native asks receive titles and descriptions;
`skill_read` loads the matching instructions from the session's own checkout.
MCP offers scoped prompts, resources and complete Skills manifests; resource
reads are not activation, and automatic MCP activation is not established.
The shared graph form is `skill{invoke, arguments, paths, fork, options}` beside
`doc{title, body}` (name and description) and `content{body}` (instructions).
The optional bidirectional mirror lands graph exports before acknowledging
them; read-only session views never import local edits. The yaks.app connector's
app-building skills remain separate work (T-61610).

## Where a piece of knowledge lives

Ask who needs it, and when.

- **The persona** (memories preloaded by `contains` edges, M-6995) holds what
  is true for every agent in every task here: the principles, the invariants,
  the owner's standing direction. Every session pays for every word of it, and it
  reaches every harness, so it stays small.
- **A skill** holds one area (how a subsystem works and the judgment around
  it), a workflow (probing a change, migrating data) or a recurring task
  (briefing an agent, writing a design). It sits beside the code it describes,
  so the commit that moves the code fixes the skill too.
- **A package README** is that package's reference: what it owns, what it
  offers and depends on, its formats. It serves anyone using the package,
  outside this repo too. A skill points at it and adds the judgment:
  `vocabulary` leans on the keyword table in packages/vocab/README.md rather
  than repeating it.
- **The owner's words** stay verbatim in the memory or comment that recorded them
  (M-31946). A skill cites the id where they set the direction (`testing` cites
  M-39441) and does not paraphrase them into rules.
- **A comment or doctest** holds the invariant of one file or function.
- **A task or a design** holds what is to be done or proposed. A skill says
  what is.

A memory preloaded into the persona that only one area needs is a skill waiting
to be written. Moving it changes the persona, so propose it to the owner in a line
(M-31947).

## The name

The name is also the slash command (`/query-grammar`). A skill that teaches
gets a longer name that says its subject (`query-grammar`,
`graph-reads-and-writes`, `end-to-end-checks`); short verb-like names (`query`,
`test`, `design`) are kept for skills that do something, someday (M-61646).
Lowercase words and hyphens, the same as the folder. The owner kept `vocabulary`,
`sharing` and `yaks-app` as they were.

A rename is a rename (M-17871): `git mv` the folder, change `name:`, and change
every mention in the other skills in the same commit
(`grep -rn 'old-name' .claude/skills`).

## The description is the trigger

An agent decides whether to load a skill from its description alone, mid-task,
thinking about the task and not about skills. Agents load too few skills, not
too many, and skip them on work that looks simple (skill-creator's guidance),
which is where a mistake here is cheapest to prevent. So the description is
written to be found:

- **What it covers, in a phrase**, first: "How a yaks query is written and
  read".
- **The situations, as the agent meets them**: the files it is touching
  (`packages/ui`, any vocab.json), the commands and tools it is about to call
  (`yak graph apply`, the Agent tool, `yak session spawn`), the symptom in
  front of it ("a write that landed as the wrong writer", "a run that loops").
  Say "whenever", and "even for a one-line fix" where that is the trap.
- **The words of requests that never say the skill's word.** Nobody asks to
  use the vocabulary; they ask to "add a field", "track whether X happened",
  "link X to Y". `end-to-end-checks` fires on "make sure it works".
- **What it is not for, and which skill owns that.** Two skills that could
  claim one moment both say who owns it, in the same terms: `vocabulary` shapes
  a component, `data-migration` moves its stored rows, `graph-reads-and-writes`
  is how one read or write behaves. A boundary stated in one description only
  is half a boundary.
- **Under 1,024 characters**, the spec's limit; most here run 600 to 950.

The frontmatter is `name` and a folded `description: >`. Nothing here reads
any other key. All of "when to use it" goes in the description, since the body
is read only after the choice is made.

To check a description, write three requests that need the skill without
naming it, the way the owner would type them, and find the words in the description
each one would match. skill-creator's trigger evals measure it properly and
cost time and money; save them for a skill that keeps failing to fire.

## The body

Write for an agent who has just loaded it mid-task and will act on it at once.

- **Open with what is**: a paragraph on how the area works, the model the rest
  hangs on, so the reader can reason about a case the skill never lists.
- **Explain; don't legislate** (M-6994). Say why agents get this area wrong
  and what is true instead; `vocabulary` opens on what goes wrong when a word
  is designed by feel. A list of don'ts teaches only the cases it names, and is
  obeyed at the edge where it is wrong. Steps can be imperative; the reasons
  carry the judgment.
- **Pointers, not copies** (M-14370): a file and its section, a memory, task or
  design id. A copied table or schema goes stale when the code moves, and the
  skill then teaches the old shape with authority. Copy only what an agent
  needs in hand to act: a command with its flags, a literal syntax.
- **Run every command and open every path before writing it down**: `yak help
  <command>`, `ls`, the query itself. A skill is trusted more than a guess, so
  a wrong flag in one is repeated by every agent that loads it (M-37958).
- **What is, and a bug is not what is.** Name the task that fixes it rather
  than teaching the workaround. Today's behavior written as the rule is how a
  skill, like a brief, preserves what the owner wants gone.
- **Mark what is designed but not built**, with its id: "Namespacing (D-59567)
  is designed, not built". The line changes when it lands.
- **No dates, war stories, "used to" or "supersedes"** (M-4404). The history
  is in git.
- **Nothing the persona already says.** It is loaded already; cite the id when
  the reader needs to know which rule bites here.
- **Short enough to read in one go**: the skills here are 80 to 250 lines.
  Past about 500, split it, or move reference material into a file beside it
  and say when to read that file.
- **Nothing private**: the repo is public (M-17876), so no secrets, fleet data
  or owner data.

## Scripts beside the skill

Code every agent in a workflow would otherwise write again goes in `scripts/`
once, and the body says how to run it: `end-to-end-checks` reads a page's DOM
over CDP with `deno run -A <this skill>/scripts/dom.ts <cdp port> <url>
'<expression>'`. The script's header carries its usage. deno.json excludes
`.claude`, so `deno task check` never sees the script; run it once before
landing.

## One home per idea

Each idea is taught in one skill, and the others point at it. Split where an
agent's moment splits: `query-grammar` came out of `graph-reads-and-writes`
because an agent filling in a board's query needs the grammar and none of how
writes behave. Move the text rather than copying it, and the old skill says
"How a query is written is `query-grammar`". Merge two skills that always fire
together and never apart.

Before landing a new skill or a changed description, in the same commit:

1. Read every description: `head -n 22 .claude/skills/*/SKILL.md`.
2. Put the boundary in both descriptions wherever another skill could claim a
   moment yours claims.
3. Grep the other skills for what yours now teaches
   (`grep -rn 'topic' .claude/skills`), delete the copies, and point.

`sharing` is the fleet's: the same file sits in every venture, from holdco's
template (~/code/holdco/templates/new-venture/.claude/skills/sharing), so a
change to it goes to the template too.

## Writing one from a session

A session that learned how an area works, by building it or from the owner's
corrections, loses it at its end unless something holds it. The context that
holds it writes the skill: a fork of that session, which has all of it, not a
fresh agent handed a summary. Then the locus reads the skill before calling it
done. The writer writes fluently whether or not it checked; the reader, who
was there, catches the claim nobody ran, the paraphrase of the owner, the copy of
what another skill owns.

When the owner corrects something in one area, the fix is usually in that area's
skill: find the line that produced the wrong behavior and rewrite it, rather
than adding a line beside it (M-4404, M-14769).

Reviewing a skill is reading it as the agent who loads it, cold and about to
act, against the sections above: would the description have fired on the
requests that needed it, does every command run, is any sentence a guess, does
it repeat the persona or another skill, does it explain or only order.

## The closing line

Every skill here except `sharing` ends with the line that ends this one. A
skill drifts from the code it describes, and the agent who notices is the only
one who knows; the line gives that agent the license, so a skill gets better
each time it is used instead of going stale. Nothing checks that agents follow
a skill (M-37840): when one keeps being missed or misread, its words are what
to fix.

When this skill is wrong or missing something, fix it in the same change.
