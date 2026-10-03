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
middle of a task, or a stranger reading a package on jsr.io. Technical writing
serves that reader with fixed terms. A term is defined once; from then on that
word always means that thing, and that thing is always called by that word. A
reader who meets a second word for it assumes a second thing, and either goes
looking for it or builds on the wrong one. The owner's words are on T-64477.

## Why you drift

You hold a word by its meaning, not its letters (M-12915). "Bundle", "record"
and "row" sit close together in you, so when you write about a bundle you take
whichever comes first, and from the inside the new word feels like the old one.
Each context coins its own, the next reader copies the coinage, and after a few
hands one concept has three names that nobody can tell apart. That is the
synonym telephone this skill exists to stop.

## Terms

- **Define a term where it is first used.** Set it in bold and say what it is
  in a sentence, with a literal example when the shape matters. @yaks/graph's
  "Data model" section is the model: "A **bundle** is one entity's components as
  a JSON object, including its identity: `{ entity: { eid: 'b1' }, … }`".
- **The terms the rest builds on come right after the summary.** A term that
  only matters later is defined where it first appears. There is no glossary at
  the end: it would be a second copy of every definition, it would drift, and a
  reader in the middle of a task rarely reaches it.
- **Then use it exactly**, in prose, headings, comments, error messages,
  commit messages and replies. The defined terms are mostly concepts; some are
  also types or functions (`apply`, `bundle`, `phase`, `vocabulary`, `plugin`,
  `storage`). Every function does not need a term.
- **One home per term.** The package that owns an idea defines it, and other
  packages link to that definition and use the word, never define it again:
  `[bundle](../graph/README.md#data-model)`.
- **Prose uses the code's word.** If the identifier is `duties`, the prose says
  duties, never "background jobs". If the code's name is wrong, the fix is to
  rename the code, and the owner picks the name (M-12915, M-17871); a nicer word
  in the prose only adds a second name.
- **Look the word up before writing it.** Your recall gives back the meaning;
  the string has to be found. `grep -rn '\*\*bundle\*\*' packages/*/README.md`
  shows where a term is defined; grep the identifiers for what the code calls
  it. In your own draft, a word you did not find defined anywhere is a possible
  synonym: check it before it ships.
- **Verbs drift too.** A verb you reach for in prose ("the machine a space is
  linked to") turns into the next identifier (`x-yak-link` for what is a
  tunnel). Describe a thing by its term ("the space's tunnel") even when a verb
  comes easier.
- **Words about words.** Two different words are two names. A spelling is one
  of two ways to write the same word (`colour`, `color`).

## A package README

A README starts with what a stranger needs first and grows from there:

1. **A summary**: what the package is and what it is for, in a short paragraph.
   It agrees with the `description` in the package's deno.json, which is what
   jsr shows.
2. **The terms** the rest of the README builds on.
3. **A complete example** of the common use, early, runnable as written.
4. **Each thing it offers**: its exports (the table the packages already
   carry), and a section per part, each with its example.
5. **Its limits**: what it does not do, and which package does.

The order can bend to the package. The terms and the early example are what
make the rest readable.

## Examples

- **Every major feature is shown.** After writing, walk the exports and the
  sections: a feature a reader would use with no example beside it is a gap,
  so add one. Short and complete, the common case first.
- **Examples run.** A fenced `ts` block in a README or a doc comment runs as a
  test on the deno platform (`deno task test packages/<name>`), so an example
  cannot quietly go stale. Mark a block `ts ignore` only when it cannot run
  here (it needs a network, a Worker or a secret), and say why beside it.
- **An example checks itself**: `equal` from @yaks/testing, as the packages'
  READMEs do, so a reader sees the result and the test sees it too.
- **The example shows; the prose explains why.** Don't restate in a sentence
  what the example already shows.

## What a document says

- **What is.** No history, no "used to", "new" or "now", no dates (M-4404). The
  history is in git. What is designed but not built is marked with its id:
  "Namespacing (D-59567) is designed, not built".
- **Only what you checked.** Run the command and read the code before writing
  how something behaves; a claim with no source is a guess (M-37958), and a
  document is trusted more than a guess.
- **A README faces outward.** jsr publishes it, so it speaks to someone outside
  this repo: no task ids, fleet data or the owner's name. Judgment for agents
  working here goes in a skill, which points to the README. A guide page under
  workers/yak/public/docs is read by people on yaks.app and their assistants.
- **Pointers, not copies.** Link to another package's documentation rather than
  restating it; a copy goes stale when that package moves.
- **Plain and short.** One idea per paragraph, sentences a stranger can use,
  italics for emphasis and never capitals (M-37800), and nothing the reader
  does not need in order to act.

## Comments and file headers

Every file opens with a paragraph saying what it owns, and a comment says why
and the invariant, never the next line. They use the same terms as the README,
looked up the same way.

## Before you finish

Read the document as the stranger who opens it cold. Check that every term is
defined before it is leaned on, that each concept has one name throughout, that
every major feature has an example, and that `deno task test packages/<name>`
runs the examples green.

When this skill is wrong or missing something, fix it in the same change.
