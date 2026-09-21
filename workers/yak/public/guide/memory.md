---
doc:
  title: What the person said
guide:
  slug: memory
  brief: the words a person wants remembered
  description: >-
    memory_save and memory_recall: keeping what the person said about how
    they want things done, in their own words rather than your summary of
    them — what belongs in a memory, what context is for and what it is not,
    when to reach for each tool, how a recall is ranked, how a memory differs
    from the notes an app keeps, and where a document you wrote goes instead:
    project documents, written into the app's store as entities and found
    again with search.
---

# What the person said

A person says how they want things done once — "use grams, never cups" — and
then says it again next month, to a different agent, because the first
conversation ended. `memory_save` is where that sentence goes to stop being
said, and `memory_recall` is how it comes back.

The rule is one line long: **keep their words, not your summary of them.**

This page is those two tools: what belongs in a memory, what does not, how they
are ranked, and how they differ from an app's `NOTES.md`.

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
paraphrase carrying the person's authority, and the next agent cannot tell the
difference.

## What context is for, and what it is not

Context is a handle, not a record. It names what was being worked on, not what
was concluded:

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
_how_ rather than _what_: "always show me the link", "keep the pages plain",
"don't ask me before you deploy", "put the newest at the top".

Recall before you build or change anything, and whenever a choice is one they
might already have made:

    memory_recall { words: 'how should the pages look' }

Give it a few words describing what you are about to do. Results are ranked by
meaning where this platform can — the memories nearest to what you are asking
about, whatever wording either of you used — and by the words themselves
otherwise. With no `words` at all you get the newest.

Each one comes back whole: the sentence, its context, who said it and when.
Never a snippet — half of what somebody said is worse than none of it.

## They come back with `about`

The newest few come back with `about`, under a heading of their own, beside the
notes of every app you can reach — so one call at the top of a conversation is
usually the whole of it. `memory_recall` is for the rest, and for the moment a
particular question comes up.

They belong to the space, not to an app. Everyone in the space reads them and
everyone who may write there can save one, so a thing said to one agent about
one app is known to every agent working anywhere in that space.

## Against a NOTES.md

`about` returns both, and they hold different things:

- **`NOTES.md`** is the rules for one app, written by an agent, in whatever
  words make them followable — "every ingredient's amount is repeated in the
  step that uses it". It lives beside that app's `index.html`. See
  <https://yaks.app/guide/notes.md>.
- **A memory** is what the person said, in their words, across the whole space —
  "use grams, never cups".

When they state a rule for one app, both are right: keep their sentence with
`memory_save`, and write the rule the app is to be built by into its `NOTES.md`.

## Project documents

A memory is the person's sentence. A `NOTES.md` is how one app is kept, in their
terms, in four kilobytes. Neither is the place for a document you wrote — how
the game's combat resolves, the shape a page expects its rows in, why the
schedule is generated a month ahead, the overview somebody asked you to write
down. That is not a sentence to preserve and it is not house rules.

Write it where the app's own knowledge already lives: as an entity in the app's
store, which is what `doc` is for.

    graph_apply({ app: 'idler-rpg', entities: [{
      entity: { eid: '$d' },
      alias: { name: 'combat' },
      note: {},
      doc: {
        title: 'Combat',
        body: '# Combat\n\nA tick is ten seconds...' } }] })

`doc.title` and `doc.body` are both searched, so the document is findable the
moment it is written — by anyone, in any conversation, including you next week:

    search({ text: 'a swing resolves' })
    graph_query({ app: 'idler-rpg', query: '.note!&.doc?' })
    graph_show({ ids: ['combat'] })

Give `search` the words that are in the document, not the question you want
answered: it matches the text as a phrase, ranked, where `memory_recall` ranks
by meaning. A trailing `*` prefix-matches the last word.

Two small things make that work, and both are ordinary:

- **A component of its own.** `note: {}` — declared in the app's `vocab.json`
  with no columns at all — is what separates your documents from the app's own
  data, which has `doc` on it too. Then `.note!` is the whole reading list.
- **A name.** `alias: {name: 'combat'}` makes the write idempotent: writing
  "combat" again patches the document that already holds that name instead of
  leaving two, and a name can be used wherever an eid can, so `graph_show` reads
  it back without a lookup.

They are rows in the app's store like any other, so they travel with the app, a
member reads them, and whatever they held an hour ago can be put back for thirty
days.

What they must not be is a memory. `memory_save` is for the person's words and
nothing else, and a document of yours saved there is your prose carrying their
authority — handed to the next agent as something they said. When they ask for
an overview to be kept, both halves are right: keep their sentence with
`memory_save`, and write the document into the store.
