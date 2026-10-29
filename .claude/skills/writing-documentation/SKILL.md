---
name: writing-documentation
description: >
  Use for READMEs, guide pages, doc comments, opening file prose, examples,
  titles, headings, or explaining a feature/term. Covers plain technical
  prose and consistent defined terms. Skills are skill-writing; proposals
  are design-docs; component names are vocabulary; marketing is
  yaks-app-business.
---

# Writing documentation

Documentation here is read by someone about to act on it: an agent in the
middle of a task, a stranger opening a package on jsr.io, a person on yaks.app
reading a guide page with their assistant. None of them can ask you what you
meant. What they have is the words: a title that names the subject, sentences
that say what they mean, and terms that keep one meaning from the first page to
the last. The owner, verbatim (T-64477):

> I'm hoping to solve the "synonym telephone" problem: agents tend to use
> synonyms and then it's tricky to keep everything straight, because that's not
> usually how technical writing works: it should have clearly defined terms and
> then those terms should always be used.

## Literal titles, plain sentences

A reader decides from a title whether a page holds what they need, and from a
sentence what it means, on the first read. An agent building someone's app
scans the guide's list of titles for the word it has in mind: "backend",
"performance", "email", "payments". The owner, verbatim (T-132747):

> also, the docs need to have much better titles that are a bit more literal.
> they're so vague and too quippy. "The store, from a page". "A page that loads
> at once". huh? "Frontend Data" and "Performance". this quippy way of talking,
> called "mannered prose" is so bad for comprehension. please fix up the docs

> "Code of your own" -> "Backend Code"? this is crazy. who would ever write
> this way?

and, asked whether yaks.app's soft and friendly voice had spread into the
guide:

> well yes, but the docs are the place for explicitness and technicality!

Mannered prose is writing arranged for effect instead of said (M-33081): a
heading that is a little sentence ("The eid is the thing"), a possessive turn
in place of a name ("Code of your own"), a scene in place of a subject ("A page
that loads at once"), a paragraph that ends on an aphorism ("None of those is a
ceiling"). The writer means it as style. The reader has to translate it back
into the term they came looking for, and a search for "backend" never finds
"Code of your own". You reach for these phrases because they sound well
written; in documentation they make the text vague.

- **A title is the subject's standard technical name**, the words an engineer
  would type into a search box: Frontend Data, Backend Code, Performance, Query
  Syntax, Custom Domains, Email, Payments, Scheduling. A guide page's
  `doc.title`, its `#` heading and its section in the guide's map (docs.md)
  are the same words. The title is the reader's word, and the page then
  defines the platform's own term under it: Frontend Data introduces the
  **store** and its client.
- **A heading names what its section covers**: "Patching and deleting",
  "Compare-and-set with `$was`", "Limits". It isn't a sentence about the
  section, a teaser or a pun.
- **A sentence states the fact**: what the thing is, what it does, what it
  returns, what it refuses. When a literal phrase is available, use it. Leave
  out metaphors, inverted word order and a last line written to sound good.
- **Explicit and technical.** Name the function, the endpoint, the status code,
  the limit and its number, with the standard term for each: backend, frontend,
  API, request, query, schema. The guide is reference. The soft, friendly voice
  the owner asked of yaks.app (M-32311, and for the homepage, T-32746: "soft and
  friendly. not this AI-technical analytical modern nonsense.") belongs to the
  homepage and the marketing pages (`yaks-app-business`), not the guide.

## Defined terms

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

You remember a term by its meaning, not its spelling, so search for the
string. This shows where a term is defined:

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
- **Plain and short.** One idea per paragraph, said directly (see Literal
  titles, plain sentences), nothing the reader doesn't need in order to act.
  For emphasis, the owner (M-37800, verbatim): "never use ALL CAPS for
  emphasis. use italics if emphasis is necessary."

Every file opens with a paragraph saying what it owns, and a comment says why
and the invariant rather than the next line. Both use the README's terms,
looked up the same way.

Then read it back as the stranger who opens it cold: does each title and
heading say what it covers, does each sentence mean what it says on the first
read, is every term defined before it's leaned on, does each concept keep one
name all the way through, does every major feature have an example, and does
`deno task test packages/<name>` run them green?

When this skill is wrong or missing something, fix it in the same change.
