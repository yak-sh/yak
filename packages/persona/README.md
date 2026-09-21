# @yaks/persona

Who is acting, what they are responsible for, and the instructions they run
with.

```sh
deno add jsr:@yaks/persona
```

- `person` — a human being the graph knows, addressable by name.
- `persona{home}` — a set of instructions an agent runs with. The `doc` body on
  the same entity IS the instruction text, and `home` is the project it works
  for. The component is marked `governed`, so [@yaks/project](../project)'s
  check reports a persona no project can reach.
- `role{state, surface, scope}` — what an agent running a persona is responsible
  for, and whether it is currently running. When it next runs is a
  [@yaks/wake](../wake) `wake` pointing at it, where it works is a
  [@yaks/git](../git) `worktree`, and what it last decided is
  [@yaks/kernel](../kernel)'s `decided` — the role does not keep a second copy
  of any of them.

There is no verify/fix loop in this package. `verifier`, `fixer`, `finding`,
`bug`, `nofix` and `noverify` were the fleet's review pipeline, and that
pipeline is what stopped things getting built; a persona needs none of it.

An agent is not a person, and a role is neither: it is a job that a persona is
assigned to. Keeping the three apart is what makes an author stamp
(`created.by`) worth reading.

## Rendering a persona

A persona links to the documents it is built from — a `contains` edge for each
document included in full, a `reads` edge for each one mentioned by id only —
and those documents, plus the persona's own body, render as a single markdown
document: what an agent is given at the top of its context.

```ts
import { voice, wear } from '@yaks/persona'

let worn = await wear(storage, vocab)('N-1')
if (worn) console.log(voice(vocab)(worn))
```

`wear(storage, vocab)(eid)` reads the persona and the documents its edges point
at. `voice(vocab)(worn)` renders them:

```md
# N-1 TaskMaster

the instructions themselves

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

- **It returns TEXT, and never writes a file.** Where the document goes —
  `AGENTS.md` in a repo, the system prompt of a spawned agent, a card in a
  browser — is the caller's decision, and a package that wrote files could only
  guess at one of those. That is also why there is no `./effects` export here:
  an effect would have to know that destination to be worth registering.
- **What a persona links to is a `doc`, nothing more specific.** A memory is
  [@yaks/memory](../memory)'s component and a goal is [@yaks/goal](../goal)'s; a
  persona that links to either renders it the same way, because the only thing
  this package requires of a linked entity is that it has a `doc`. Nothing here
  restates another package's components.
- **An included persona is folded in.** Its instruction text is included like
  any other document, and the documents IT links to are added to the ones this
  persona links to, so a base persona reaches every persona built on top of it
  and nobody copies its text. A persona linked by `reads` is only listed by id.

The order is the order someone authored: an edge's `ord` column first, then the
id of the entity it points at. The fleet's materializer used to sort these by a
warmth score that decayed against the wall clock, so two documents nobody had
touched could swap places between renders — a file written from it went stale
with no graph write behind it.

## Exports

| subpath   | what it provides                                                      |
| --------- | --------------------------------------------------------------------- |
| `.`       | `wear`, `voice`, the component names, and the vocabulary document     |
| `./vocab` | the component declarations alone                                      |
| `./tools` | `persona_read` — a persona rendered as the markdown an agent is given |

The two edge relations are borrowed rather than invented here: `contains` is
[@yaks/task](../task)'s and `reads` is [@yaks/kernel](../kernel)'s. A relation
the composed vocabulary does not declare contributes nothing rather than
throwing — a graph with no `contains` in it has a persona that includes no
documents, which is a fair reading of that graph.

## Compatibility

Deno, Node and the browser — it calls no platform API.
