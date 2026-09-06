# What the person said

A person says how they want things done once — "use grams, never cups" — and
then says it again next month, to a different agent, because the first
conversation ended. `memory_save` is where that sentence goes to stop being
said, and `memory_recall` is how it comes back.

The rule is one line long: **keep their words, not your summary of them.**

This page is those two tools: what belongs in a memory, what does not, how they
are ranked, and how they differ from an app's `AGENTS.md`.

The map is at <https://yaks.app/guide.md>.

## The shape

Two things go in, and only two:

    memory_save {
      said: 'use grams, never cups',
      context: 'setting up the recipe app',
      about: 'recipes'
    }

`said` is the person's sentence, exactly as they said it. `context` is the one
line somebody needs in order to read that sentence later — what was being talked
about when they said it. `about` names an app, by slug, where the words were
about one; leave it out where they were about everything.

That is the whole shape. There is no title, no category, no summary field, and
nothing for what you concluded from what they said.

## Why verbatim

An agent that summarises what somebody told it can only ever remove information.
Everything the summary keeps was already in the sentence; anything it drops is
gone, and no agent afterwards can get it back — including you next week. Six
months of that and the person's own words have been through a dozen rewrites and
mean something else.

So save the sentence:

    said: 'i want it to feel soft and friendly, not technical'

and not what you took from it:

    said: 'user prefers approachable UI copy'      ← no

The second one reads like a decision somebody made. Nobody made it. It is your
paraphrase wearing the person's authority, and the next agent cannot tell.

## What context is for, and what it is not

Context is a handle, not a record. It says what was on the screen, not what was
concluded:

    said: 'never on a Sunday'
    context: 'about the app mailing the volunteer list'      ← yes

    said: 'never on a Sunday'
    context: 'The user asked that outbound mail be suppressed on
      weekends, which we implemented by checking the day in worker.js
      before calling deliver, see the sendable() helper…'       ← no

Two lines is the ceiling, and a save with more is clamped to the first two. If
the words stand on their own, leave it out.

## Reaching for it

Save the moment they state a preference, a standard, a taste, a way of working,
or something they never want done again. The tell is that they are talking about
HOW rather than what: "always show me the link", "keep the pages plain", "don't
ask me before you deploy", "put the newest at the top".

Recall before you build or change anything, and whenever a choice is one they
might already have made:

    memory_recall { words: 'how should the pages look' }

The words are what you are about to do, in a few words. They are ranked by
meaning where this platform can — the memories nearest to what you are asking
about, whatever wording either of you used — and by the words themselves
otherwise. With no `words` at all you get the newest.

Each one comes back whole: the sentence, its context, who said it and when.
Never a snippet — half of what somebody said is worse than none of it.

## They arrive on their own

The newest few are handed to every agent that connects, under a heading of their
own, before anything else is asked. So the common case needs no tool call at
all: you have already read them. `memory_recall` is for the rest, and for the
moment a particular question comes up.

They belong to the SPACE, not to an app. Everyone in the space reads them and
everyone who may write there can save one, so a thing said to one agent about
one app is known to every agent working anywhere in that space.

## Against an AGENTS.md

Both are read at the start of every conversation, and they hold different
things:

- **`AGENTS.md`** is the rules for ONE app, written by an agent, in whatever
  words make them followable — "every ingredient's amount is repeated in the
  step that uses it". It lives beside that app's `index.html`. See
  <https://yaks.app/guide/instructions.md>.
- **A memory** is what the PERSON said, in their words, across the whole space —
  "use grams, never cups".

When they state a rule for one app, both are right: keep their sentence with
`memory_save`, and write the rule the app is to be built by into its
`AGENTS.md`.
