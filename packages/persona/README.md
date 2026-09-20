# @yaks/persona

Who is speaking, what they are for, and what they say.

- `person` — a human the graph knows, addressed by name.
- `persona{home}` — a voice an agent wears: a doc whose body is the voice, filed
  under the project it speaks for. A governed facet.
- `role{state, surface, scope}` — what an agent wearing a persona is FOR: the
  work it is responsible for, and whether it is running. When it wakes is a
  [@yaks/wake](../wake) `wake` pointed at it, where it works is a
  [@yaks/git](../git) `worktree`, and what it last decided is
  [@yaks/kernel](../kernel)'s `decided` — a role does not keep a second copy of
  any of them.

There is no verify/fix loop here. `verifier`, `fixer`, `finding`, `bug`, `nofix`
and `noverify` were the fleet's review pipeline, and that pipeline is what
stopped things being built; a persona needs none of it.

An agent is not a person. Keeping the two words apart is what makes a byline
(`created.by`) worth reading — and a role is neither: it is a job, which a
persona is hired into.

## The act: a persona, said

A persona holds edges to the documents it stands on — `contains` for the ones it
carries and `reads` for the ones it only names — and those, plus its own body,
are one markdown document: the projection an agent reads at the top of its
context.

```ts
import { voice, wear } from '@yaks/persona'

let worn = await wear(storage, vocab)('N-1')
if (worn) console.log(voice(vocab)(worn))
```

```md
# N-1 TaskMaster

the voice itself

---

# M-3 delegation discipline

## The line

Fork work. Do the knowing yourself.

---

## Reads

Named here, not carried — ask the graph for one by id.

- M-9 tickets carry signal
```

Three things this shape decides:

- **It answers TEXT, never a file.** Where the document lands — `AGENTS.md` in a
  repo, a spawn's system prompt, a card in a browser — is the host's, and a
  package that wrote files could only ever guess at one of them. That is also
  why there is no `./effects` here: an effect would have to know that landing
  place to be worth registering.
- **A tier holds DOCS, not memories.** A memory is [@yaks/memory](../memory)'s
  word and a goal is [@yaks/goal](../goal)'s; a persona carrying either renders
  the same way, because the only thing this package asks of what it holds is a
  `doc`. Nothing here restates another package's words.
- **A carried persona folds in.** Its voice is carried like any other document
  and what IT holds joins what this one holds, so a base persona reaches every
  voice worn on top of it and nobody copies its text. A NAMED persona is only
  named.

Order is the order somebody authored: an edge's `ord`, then the end it points
at. The fleet's materializer sorted these by a warmth score that decays against
the wall clock, so two documents nobody touched could swap places between
renders — a file written from it went stale with no graph write behind it.

## Facets

| subpath   | what a host takes                                             |
| --------- | ------------------------------------------------------------- |
| `.`       | `wear`, `voice`, the component names, the vocabulary document |
| `./vocab` | the words                                                     |
| `./tools` | `persona_read` — a persona, as the markdown an agent wears    |

The two tier relations are borrowed, not coined: `contains` is
[@yaks/task](../task)'s word and `reads` is [@yaks/kernel](../kernel)'s. A
relation a composed vocabulary does not declare contributes nothing rather than
throwing — a graph with no `contains` in it has a persona that carries nothing,
which is a fair reading of that graph.

## Compatibility

Deno, Node and the browser — it reaches no platform API.
