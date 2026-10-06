---
name: writing-documentation
description: >
  How documentation in the yaks repo is written: package READMEs, guide pages
  under workers/yak/public/docs, doc comments and a file's opening paragraph,
  and any prose that explains how something works. Use it whenever you write or
  edit a README or a guide page, describe a package, feature or term for a
  reader, add or change an example, or name a concept in prose, even for a
  one-line doc fix, and when a request says "document this", "write it up",
  "explain how X works" or "update the README". Terms are defined where they
  are first used and then used exactly, never a synonym, and every major
  feature has a short example that runs. A skill is `skill-writing`, a design
  is `design-docs`, naming a component is `vocabulary`, and which files a
  package carries is `packages-and-plugins`.
---

# Writing documentation

Documentation here is read by someone about to act on it: an agent in the
middle of a task, a stranger opening a package on jsr.io, a person on yaks.app
reading a guide page with their assistant. None of them can ask you what you
meant. What they have is the words, and good technical writing gives them words
that hold still. The owner, verbatim (T-64477):

> I'm hoping to solve the "synonym telephone" problem: agents tend to use
> synonyms and then it's tricky to keep everything straight, because that's not
> usually how technical writing works: it should have clearly defined terms and
> then those terms should always be used.

## A term is a variable

A term in prose works like a name in code. It's bound once, where it's defined,
and every later use refers to that binding. Rename it halfway through and the
reader's program breaks: a reader who meets a second word assumes a second
thing, and either goes looking for it or builds on the wrong one. What school
taught as elegant variation is, here, a second variable for one value.

The pull the other way is strong in you, and it comes from how you hold words:
by meaning, not by letters (M-12915). "Bundle", "record" and "row" sit close
together, so writing about a bundle you take whichever comes first, and from
the inside the new word feels like the old one. Each context coins its own, the
next reader copies the coinage, and a few hands later one concept has three
names nobody can tell apart. The owner, verbatim: "it's like agents really do
run on "vibes". as long as the vibe of the word is the same, they can't tell
them apart".

So a term gets one home and one word, and the work is mostly in keeping it
that way:

- **It's defined where it's first used**, in bold, in a sentence, with a
  literal example when the shape matters. @yaks/graph's "Data model" section
  is the model: "A **bundle** is one entity's components as a JSON object,
  including its identity: `{ entity: { eid: 'b1' }, … }`". The terms the rest
  builds on come right after the summary; one that matters only later is
  defined where it appears. A glossary at the end would be a second copy of
  every definition, it would drift, and a reader mid-task rarely gets there.
- **Then it's used exactly**, in prose, headings, comments, error messages,
  commit messages and replies. The terms are mostly concepts, and some are also
  types or functions (`apply`, `bundle`, `phase`, `vocabulary`, `plugin`,
  `storage`). Not every function needs to be a term.
- **It has one home.** The package that owns the idea defines it; others link
  to that definition and use the word:
  `[bundle](../graph/README.md#data-model)`.
- **Prose uses the code's word.** If the identifier is `duties`, the prose says
  duties, not "background jobs". When the code's name is wrong, the fix is a
  rename of the code, and the owner picks the name (M-12915, M-17871;
  `vocabulary` for a component's name); a nicer word in the prose is only a
  second name.
- **Verbs drift too.** A verb you reach for in prose ("the machine a space is
  linked to") becomes the next identifier. That's how a tunnel's header came
  to be `x-yak-link`, until the owner asked "why not x-yak-tunnel?" and it was
  renamed. Describe a thing by its term ("the space's tunnel") even when a verb
  comes easier.
- **Words about words drift the same way.** Two different words are two names.
  A spelling is one of two ways to write the same word (`colour`, `color`).

Your recall gives back the meaning; the string has to be found. This shows
where a term is defined:

```sh
grep -rn '\*\*bundle\*\*' packages/*/README.md
```

and grepping the identifiers shows what the code calls it. In your own draft, a
word you didn't find defined anywhere is a possible synonym, worth a look before
it ships.

## A package README

Which files a package carries is `packages-and-plugins`; how its README reads
is here. A README grows from what a stranger needs first:

1. **A summary**: what the package is and what it's for, in a short paragraph.
   It agrees with the `description` in the package's deno.json, which is what
   jsr shows.
2. **The terms** the rest of the README builds on.
3. **A complete example** of the common use, early, runnable as written.
4. **Each thing it offers**: its exports (the table the packages already
   carry), and a section per part, each with its example.
5. **Its limits**: what it doesn't do, and which package does.

The order bends to the package. The terms and the early example are what make
the rest readable.

## Examples that run

An example is where a reader learns fastest and where a document goes stale
first, so ours are tests. A fenced `ts` block in a README or a doc comment, and
a `///` doctest, runs on the deno platform with the package's tests
(@yaks/testing):

```sh
deno task test packages/<name>
```

An example checks itself with `equal` from @yaks/testing, as the READMEs do, so
the reader sees the result and the runner does too. A fence marked `ts ignore`
is skipped, which makes it the one example that can quietly rot; it's for code
that can't run here (it needs a network, a Worker or a secret), with the reason
beside it so the next reader knows.

Every major feature deserves one. After writing, walk the exports and the
sections: a feature a reader would use with no example beside it is a gap.
Short and complete, the common case first. The example shows; the prose around
it says why, and doesn't retell what the code already makes plain.

## What a document says

- **What is.** A document stands on its own, so it carries no history: no "used
  to", "new" or "now", no dates (M-4404). Git has the history. What's designed
  but not built carries its id: "Namespacing (D-59567) is designed, not built".
- **Only what you checked.** A document is trusted more than a guess, so a
  claim in it is one you ran or read in the code (M-37958).
- **A README faces outward.** jsr publishes it to people outside this repo, so
  task ids, fleet data and the owner's name belong elsewhere. Judgment for
  agents working here goes in a skill that points at the README. A guide page
  under workers/yak/public/docs is read by people on yaks.app and their
  assistants.
- **Pointers, not copies.** A link to another package's documentation stays
  true when that package moves; a copy doesn't.
- **Plain and short.** One idea per paragraph, sentences a stranger can use,
  nothing the reader doesn't need in order to act. For emphasis, the owner
  (M-37800, verbatim): "never use ALL CAPS for emphasis. use italics if
  emphasis is necessary."

Every file opens with a paragraph saying what it owns, and a comment says why
and the invariant rather than the next line. Both use the README's terms,
looked up the same way.

Then read it back as the stranger who opens it cold: is every term defined
before it's leaned on, does each concept keep one name all the way through, does
every major feature have an example, and does `deno task test packages/<name>`
run them green?

When this skill is wrong or missing something, fix it in the same change.
