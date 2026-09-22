# @yaks/persona

Define human identities, agent instructions and agent roles in a graph, and
assemble an agent's instructions into Markdown. The graph stores `person`,
`persona` and `role` components alongside document text and relationships. This
package supplies their schemas and read/render functions; it opens no database,
starts no agent and writes no files.

```sh
deno add jsr:@yaks/persona
```

- `person` — a human being the graph knows, addressable by name.
- `persona{home}` — a set of instructions an agent runs with. The `doc` body on
  the same entity is the instruction text, and `home` is the project it works
  for. The component declares `governed`, meaning it should be associated with a
  project, so [@yaks/project](../project)'s check reports a persona no project
  can reach.
- `role{state, surface, scope}` — what an agent running a persona is responsible
  for, and whether it is currently running. When it next runs is a
  [@yaks/wake](../wake) `wake` pointing at it, where it works is a
  [@yaks/git](../git) `worktree`, and what it last decided is
  [@yaks/kernel](../kernel)'s `decided` — the role does not keep a second copy
  of any of them.

This package does not implement the legacy server's review-and-repair pipeline.
It does not declare `verifier`, `fixer`, `finding`, `bug`, `nofix` or
`noverify`. A person identifies a human, a persona contains agent instructions,
and a role represents an assigned job. Keeping these separate lets provenance
fields such as `created.by` identify the actual author rather than the job.

## Rendering a persona

A persona links to the documents it is built from — a `contains` edge for each
document included in full, a `reads` edge for each one mentioned by id only —
and those documents, plus the persona's own body, render as a single markdown
document: what an agent is given at the top of its context.

The example creates an in-memory graph and renders one persona. An entity is a
record with an id; a bundle is a JSON object containing that entity's
components. Use a persistent storage adapter instead of `ram` to retain these
records.

```ts
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { personaDoc, voice, wear } from '@yaks/persona'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([docDoc, personaDoc])
let storage = ram(vocab)
let g = graph({ storage, vocab })
await g.apply([{
  entity: { eid: 'reviewer' },
  persona: {},
  doc: { title: 'Code reviewer', body: 'Check changes against the tests.' },
}])
let worn = await wear(storage, vocab)('reviewer')
if (worn) console.log(voice(vocab)(worn))
```

`wear(storage, vocab)(eid)` reads a persona by its stored entity id and follows
its document relationships. It returns `undefined` if that entity is missing or
is not a persona. `voice(vocab)(worn)` returns Markdown containing the persona's
instructions, each included document in full, and a `Reads` list of referenced
documents. Load @yaks/edge plus the schemas declaring `contains` and `reads` to
use those relationships. The minimal example has no linked documents.

Rendering behavior:

Three things this shape decides:

- **It returns text, and never writes a file.** Where the document goes —
  `AGENTS.md` in a repo, the system prompt of a spawned agent, a card in a
  browser — is the caller's decision, and a package that wrote files could only
  guess at one of those. That is also why there is no `./effects` export here:
  an effect would have to know that destination to be worth registering.
- **What a persona links to is a `doc`, nothing more specific.** A memory is
  [@yaks/memory](../memory)'s component and a goal is [@yaks/goal](../goal)'s; a
  persona that links to either renders it the same way, because the only thing
  this package requires of a linked entity is that it has a `doc`. Nothing here
  restates another package's components.
- **An included persona's documents are included recursively.** Its instruction
  text is included like any other document, and the documents it links to are
  added to the ones this persona links to, so a base persona reaches every
  persona built on top of it and nobody copies its text. A persona linked by
  `reads` is only listed by id.

At each nesting level, documents are ordered by their edge's `ord` column, then
by the target entity id. Missing `ord` values sort last. Nested personas are
read breadth-first for up to eight levels; cycles and repeated inclusions are
removed. Full inclusion takes precedence over a `reads` reference. This stable
ordering replaces the legacy materializer's time-decaying score, which could
change output even without a graph write.

## Exports

| subpath   | what it provides                                                        |
| --------- | ----------------------------------------------------------------------- |
| `.`       | `wear`, `voice`, the component names, and the vocabulary document       |
| `./vocab` | the component declarations alone                                        |
| `./tools` | `runs(host)` — supplies `persona_read`, which returns rendered Markdown |

The two edge relations are borrowed rather than invented here: `contains` is
[@yaks/task](../task)'s and `reads` is [@yaks/kernel](../kernel)'s. A relation
the composed vocabulary does not declare contributes nothing rather than
throwing — a graph with no `contains` in it has a persona that includes no
documents, which is a fair reading of that graph.

`host` in `runs(host)` is the process that opened the graph; it supplies the
loaded vocabulary. Tool calls supply the graph read function separately.

## Compatibility

Deno, Node and the browser — it calls no platform API.
