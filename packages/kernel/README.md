# @yaks/kernel

The base words a graph of work wears, as one vocabulary document and four
keywords — no machinery.

- **the spine**: `entity{num, archetype}`, readable and never wire-written.
- **provenance**: `created`, `updated`, `opened`, `archived`… the marks that say
  who touched a thing and when.
- **what was decided**: `proposed`, `decided`, `quarantined`, `redaction`.
- **what is attached**: `comment`, `image`, `favorite`.
- **the relation tags** an edge says: `about`, `contains`, `delegates`, `reads`,
  `recalled`, `references`, `requires`, `satisfies`, `supersedes`, `supervises`,
  `wants`, `worked` — each an ordinary component an `edge` entity wears (see
  [@yaks/edge](../edge)).

A write with no door behind it is signed by the PROCESS that made it — the
`process` row a run writes on the way in ([@yaks/process](../process)), not a
name in a config. A run of a program is not a singleton, and two `yak` lines
over one file are two writers.

## The keywords

`loadVocab(docs, [kernelKeywords])` carries three keywords the core meta-model
does not describe:

| keyword    | on        | says                                               |
| ---------- | --------- | -------------------------------------------------- |
| `governed` | component | a durable facet a project's reach is computed over |
| `lazy`     | component | a log line that never rides a boot snapshot        |
| `well`     | column    | the named well this text column completes out of   |

A transcript LINE needs no keyword: it is a component that never claims a bare
spelling, which the core meta-model already says as `bare: false`.

## Compatibility

Deno and Node — a JSON document and a keyword registration, no runtime calls.
