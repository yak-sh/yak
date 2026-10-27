---
doc:
  title: Memories
guide:
  slug: memory
  brief: store_memory_save and store_memory_recall, the person's words verbatim
  description: >-
    store_memory_save and store_memory_recall: keeping what the person said
    about how they want things done, in their own words rather than your
    summary of them — what belongs in a memory, what context is for and what it is not,
    when to reach for each tool, how a recall is ranked, how a memory differs
    from an app's NOTES.md, and where a document you wrote goes instead:
    project documents, written into the app's store as entities and found
    again with search.
---

# Memories

A **memory** is a sentence the person said about how they want things done, such
as "use grams, never cups", saved in their own words. An agent keeps nothing
between conversations, so without a memory the person has to say the same thing
again next month, to a different agent. `store_memory_save` saves a memory, and
`store_memory_recall` finds saved memories.

The main rule: **keep their words, not your summary of them.**

This page covers those two tools: what belongs in a memory, what does not, how
memories are ranked, and how they differ from an app's `NOTES.md`.

The map is at <https://yaks.app/docs.md>.

## Memory fields: `said`, `context` and `about`

A memory holds two things, the sentence and its context, and can name the app it
is about:

    store_memory_save {
      said: 'use grams, never cups',
      context: 'setting up the recipe app',
      about: 'recipes'
    }

`said` is the person's sentence, exactly as they said it. `context` is the one
line somebody needs in order to read that sentence later — what was being talked
about when they said it. `about` names an app, by slug, where the words were
about one; leave it out where they were about everything.

A memory has no other fields, and none for what you concluded from what they
said.

## Why memories are saved verbatim

An agent that summarises what somebody told it can only ever remove information.
Everything the summary keeps was already in the sentence; anything it drops is
gone, and no agent afterwards can get it back — including you next week. After
six months of this, the person's own words have been through a dozen rewrites
and mean something else.

So save the sentence:

    said: 'i want it to feel soft and friendly, not technical'

and not what you took from it:

    said: 'user prefers approachable UI copy'      ← no

The second one reads like a decision somebody made, but nobody made it. It is
your paraphrase presented with the person's authority, and the next agent cannot
tell the difference.

## What goes in `context`

`context` identifies what was being worked on when the person said it. It is not
a record of what was concluded:

    said: 'never on a Sunday'
    context: 'about the app mailing the volunteer list'      ← yes

    said: 'never on a Sunday'
    context: 'The user asked that outbound mail be suppressed on
      weekends, which we implemented by checking the day in worker.js
      before calling deliver, see the sendable() helper…'       ← no

`context` holds at most two lines, and a save with more is cut to the first two.
If the words are clear on their own, leave `context` out.

## When to save and when to recall

Save a memory as soon as they state a preference, a standard, a taste, a way of
working, or something they never want done again. The sign is that they are
talking about _how_ rather than _what_: "always show me the link", "keep the
pages plain", "don't ask me before you deploy", "put the newest at the top".

Recall before you build or change anything, and whenever a choice is one they
might already have made:

    store_memory_recall { said: 'how the pages should look' }

In `said`, describe what you are about to decide, in a few words. Recall returns
the memories nearest that in meaning, closest first, whether or not they share a
word with it, so "how the pages should look" finds "keep it soft, not
technical". A memory saved a moment ago is ranked once its vector is made, a few
seconds later. With no `said` at all you get the newest.

Each memory is returned whole, the sentence and its context, never as a snippet,
because half of what somebody said is worse than none of it.

## Memories in `about`

`about` returns the newest few memories under a heading of their own, beside the
notes of every app you can reach, so one `about` call at the start of a
conversation is usually all you need. Use `store_memory_recall` for the rest,
and when a particular question comes up.

Memories belong to the space, not to an app. Everyone in the space reads them
and everyone who may write there can save one, so something said to one agent
about one app is known to every agent working anywhere in that space.

## Memories compared with NOTES.md

`about` returns both, and they hold different things:

- **`NOTES.md`** is the rules for one app, written by an agent, in whatever
  words make them easy to follow — "every ingredient's amount is repeated in the
  step that uses it". It lives beside that app's `index.html`. See
  <https://yaks.app/docs/notes.md>.
- **A memory** is what the person said, in their words, across the whole space —
  "use grams, never cups".

When they state a rule for one app, write both: keep their sentence with
`store_memory_save`, and write the rule the app is to be built by into its
`NOTES.md`.

## Project documents

A memory is the person's sentence. A `NOTES.md` holds one app's rules, in their
terms, in at most four kilobytes. Neither is the place for a document you wrote,
such as how the game's combat resolves, the shape a page expects its rows in,
why the schedule is generated a month ahead, or the overview somebody asked you
to write down. A document is not a sentence to preserve and it is not the app's
rules.

Write it as an entity in the app's store, where the app's own data already
lives, which is what the `doc` component is for:

    graph_apply({ app: 'idler-rpg', entities: [{
      entity: { eid: '$d' },
      alias: { name: 'combat' },
      note: {},
      doc: {
        title: 'Combat',
        body: '# Combat\n\nA tick is ten seconds...' } }] })

`doc.title` and `doc.body` are both searched, so the document can be found as
soon as it is written, by anyone, in any conversation, including you next week:

    search({ text: 'a swing resolves' })
    graph_query({ app: 'idler-rpg', query: '.note&?doc' })
    graph_show({ ids: ['combat'] })

Give `search` the words that are in the document, not the question you want
answered: it matches the text as a phrase, ranked. A trailing `*` prefix-matches
the last word.

The example uses two ordinary components:

- **A component of its own.** `note: {}` — declared in the app's `vocab.json`
  with no properties at all — is what separates your documents from the app's
  own data, which has `doc` on it too. Then `.note` lists every document.
- **A name.** `alias: {name: 'combat'}` makes the write idempotent: writing
  "combat" again patches the document that already holds that name instead of
  leaving two, and a name can be used wherever an eid can, so `graph_show` reads
  it back without a lookup.

They are rows in the app's store like any other, so they travel with the app, a
member reads them, and whatever they held an hour ago can be restored for thirty
days.

Do not save a document as a memory. `store_memory_save` is for the person's
words and nothing else, and a document of yours saved there is your prose
presented with their authority, handed to the next agent as something they said.
When they ask for an overview to be kept, do both: keep their sentence with
`store_memory_save`, and write the document into the store.
