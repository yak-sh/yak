---
name: skill-writing
description: >
  How to write, change, rename, split, merge or review a skill in
  .claude/skills, and how to decide where a piece of knowledge, a workflow or a
  recurring task should live: a skill, the persona, a package README, a code
  comment or a task. Use it whenever you are about to create or edit a SKILL.md
  or a script beside one, write or tune a skill's description, fix a skill that
  fired at the wrong moment, never fired or reads like a rulebook, turn what a
  session learned about an area into something the next agent will know, or
  find area knowledge sitting in a memory, a README or a brief that every agent
  there needs, even when the request only says "write this down", "so agents
  know how this works" or "make a skill". Anthropic's `skill-creator` covers
  the format; this is the judgment on top. A brief for one agent is
  `agent-briefs`; a proposal for the owner is `design-docs`; how a README or
  guide page is written is `writing-documentation`.
---

# Writing skills

A skill is a note to a colleague who just walked in mid-task: sharp, capable,
already carrying the persona, and about to act on whatever you hand them. It
lives at `.claude/skills/<name>/SKILL.md`, with scripts beside it when a
workflow needs them. Its name and description ride along in every agent's
context, and the body loads only when the description matches the moment. So a
skill can take as long as teaching takes, and costs nothing until it's needed.

The owner, verbatim:

- "for now at least, i really want to lean into skills. for documentation,
  workflows, tasks, etc etc."
- "skills can also work well just for documentation. the auto-trigger is kinda
  what we were searching for with memories"
- "agents are so bad at prompting. you gotta put vibes no policeis!"
- "we always want skills to do at least these three things: capture any
  principles. capture what tools we have available. and set the vibe and
  attitude, the posture and orientation. we don't want to set policies to
  control behavior"

## Vibes, not policies

The reader is a frontier model. It already knows how to optimize Preact, shape
a schema or write a test. What it can't know is what we believe here, what
we've already built, and how good work in this area feels. So every skill
carries at least those three things:

- **The principles.** What we hold true in this area, and why: the ideas that
  still guide the reader when the case in front of them is one nobody wrote
  down.
- **The tools we have.** The packages, parts, commands and scripts already
  built for this work, and what each is for. A reader who knows the shelf
  reaches for what's on it instead of building another.
- **The vibe.** The attitude, posture and orientation good work here comes
  from: what we care about, what we're proud of, what makes us wince.

What a skill doesn't carry is policy, rules written to control behavior. A
rule teaches exactly the cases it names, and it gets obeyed right at the edge
where it's wrong. A sense of what we're going for travels to cases nobody
imagined. Put these side by side:

> A part that re-renders when nothing it shows has changed is a bug.

> We want screens that feel instant and light, the way a great native app does.
> Build with the instincts of a frontend engineer who cares how it feels in the
> hand.

The first gets you a test that counts renders. The second gets you someone who
notices.

So write the way you'd talk a sharp new teammate into an area over coffee: what
it's like, what tends to trip people up and why, what good looks like, where the
taste lies (M-6994). Commands and literal syntax are worth giving exactly. The
judgment around them rides on the why. When a sentence starts to sound like a
sign on a fence, there's usually a reason underneath it that's worth saying
instead. And skip what any good engineer already knows: generic advice buries
the parts that are ours.

## Where knowledge lives

Think about who needs it, and when.

- **The persona** carries what every agent needs in every task: the principles
  and the owner's standing direction (M-6995). Everyone pays for every word, so
  it stays lean.
- **A skill** carries one area, one workflow or one recurring task: the spirit
  and the specifics of one corner of the code, sitting beside it, so the commit
  that moves the code fixes the skill too.
- **A package README** is that package's reference, for anyone, including
  readers outside this repo. A skill points at it rather than retelling it.
- **A code comment** holds the invariant of one file or function. A fact about
  one app lives in that app, not in a platform skill.
- **The owner's words** stay verbatim where they were recorded (M-31946). A
  skill quotes them or points at them; it never paraphrases them into rules.
- **A task or a design** holds what's to be done. A skill says what is.

A preloaded memory that only one area needs is a skill waiting to happen.
Moving it changes the persona, so mention it to the owner first (M-31947).

## The description is how it gets found

An agent reaches for a skill from its description alone, mid-task, while
thinking about its work and not about skills. Agents under-reach, most of all
on work that looks simple. So write the description from inside the moment:
- the files they're in;
- the commands they're about to run;
- the symptom in front of them;
- the plain words of requests that never name the skill: "add a field", "make
  sure it works".

Say what it isn't for and which skill owns that, and let the neighbouring skill
say the same, so the boundary is drawn from both sides.

The frontmatter is just `name` and a folded `description: >`, under 1,024
characters (the spec's limit; most here run 600 to 950). A good gut check:
imagine three ways the owner might ask for something that needs the skill
without naming it, and see whether the description would catch each one.

## The name

The name is also the slash command. A skill that teaches gets a name that says
its subject (`query-grammar`, `end-to-end-checks`); short verbs are saved for
skills that do something (M-61646). A rename is a rename (M-17871): `git mv` the
folder, change `name:`, and update every mention in the other skills in the same
commit.

## The body

Open with how the area works: the picture everything else hangs on, so the
reader can reason about cases you never listed. Then the principles, the tools
and the feel, and what tends to go wrong and why.

A skill is trusted more than a guess, so it's worth the care of being true.
Whatever you name, you've run or opened: a wrong flag in a skill spreads to
everyone who reads it (M-37958). It describes the code as it is. Where that's a
bug, it names the task that fixes it rather than teaching the reader to live
with it, and what's designed but not built carries its id. It points at files
and ids rather than copying what will go stale (M-14370), and it leaves the
history to git (M-4404). The repo is public (M-17876), so nothing private.

It reads in one sitting. One that keeps growing is usually two skills, or has
reference material that wants a file of its own beside it.

## Scripts

When every agent in a workflow would otherwise write the same helper, write it
once in `scripts/` beside the skill, with its usage in its header.
`end-to-end-checks` does this for reading a page's DOM over CDP. deno.json
excludes `.claude`, so run a script yourself before landing it.

## One home per idea

Each idea lives in one skill, and the others point at it. Split where an agent's
moment splits; merge what always fires together. Before landing a new skill or a
changed description, skim the other descriptions
(`head -n 22 .claude/skills/*/SKILL.md`) and grep for anything yours now teaches,
so nothing is taught twice.

`sharing` belongs to the fleet. It comes from holdco's template
(~/code/holdco/templates/new-venture/.claude/skills/sharing), so a change to it
goes there too.

## Writing one from a session

The session that learned an area, by building it or by being corrected, is the
one to write it down. Ideally that's a fork that still holds everything, not a
fresh agent handed a summary. Then read it back as the agent who will load it
cold: would they have found it? Would they come away with the principles, the
tools and the feel of the place, or just a list of orders?

When the owner corrects something, the fix usually lives in that area's skill.
Find the sentence that produced the miss and rewrite it, rather than adding a
new one beside it (M-4404, M-14769).

## Reach

A skill here reaches Claude Code, native harness sessions and agents on the
box's MCP server; packages/harness/README.md has how each one finds and loads
it. The yaks.app connector's app-building skills are separate work (T-61610).

## The closing line

Every skill except `sharing` ends with the line below. Skills drift from the
code, and the agent who notices is the one holding the fix; the line is their
invitation. Nothing checks that a skill is followed (M-37840), so when one keeps
being missed, its words are what to change.

When this skill is wrong or missing something, fix it in the same change.
