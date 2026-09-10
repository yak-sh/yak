# Documentation coverage and validation

The package documentation review covers all 46 workspace packages. Every package
has a README; none needed a newly created README. The architecture guide is new.
This record describes review coverage, not a guarantee that every fenced example
has been executed.

## Coverage

| Area                     | Packages reviewed                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Core and public API      | graph, api, alias                                                                                                    |
| Storage and client       | blob, client, d1, durable-object, edge, effects, journal, ram, sql, sqlite, sync, vocab, workers, query, match       |
| Domain and execution     | context, doc, embedding, fts, git, id, key, mail, member, memory, model, names, openai, process, session, task, wake |
| Rendering and interfaces | canvas, cli, harness, html, markdown, mcp, preact, render, text, tui, yaml                                           |

Review checked introductions against public exports and implementation/tests,
clarified package responsibilities and limitations, and removed internal project
references and rhetorical descriptions. Existing API detail was retained where
useful rather than replaced with a common README template.

Specific corrections include the YAML README's unsupported `fill` example,
client setup without a vocabulary, blob transaction descriptions, Durable Object
synchronous/asynchronous expectations, and the distinction between temporary
batch aliases and persistent names. The graph and alias introductory examples
were executed against the workspace packages.

## Checks

- Package-group test runs reported 378 domain, 310 interface, and 510
  storage/client passing tests. These check package behavior, not every README
  snippet. Some examples intentionally require a host, provider, or configured
  graph and are integration fragments rather than standalone programs.
- After integration with the test-isolation fix, 234 graph/API/alias/harness
  tests passed with a temporary `HOME` and `HARNESS_DB`.
- All 46 READMEs, the architecture guide, and this coverage record were
  formatted.
- Relative Markdown file links were checked against the checkout. Remote links
  and fragment anchors were not fetched or exhaustively validated.
- No package source/API changes are part of this documentation review.

A test-isolation defect in the harness was reported during the review: a test
spread an opened store into `agent` options instead of supplying `h`, allowing
fallback to the default database. Earlier group test counts do not establish
isolation of those runs. Subsequent checks must use a temporary `HOME` and
`HARNESS_DB` until that fix is present. The README's in-memory example uses
`agent({ h: open(':memory:'), model })`.

## Follow-up areas

- Some exported APIs retain metaphorical names for compatibility. Documentation
  should explain those names rather than introduce additional synonyms.
- Runtime-specific examples need their corresponding host and credentials;
  type-checking does not verify external-provider behavior.
- Architecture describes responsibilities, not a universal support matrix.
  Query/transaction differences between adapters remain in their package
  READMEs.
- The harness still has coarse domain-projection refreshes in addition to
  granular local UI subscriptions. Its maintainer notes describe the remaining
  design work; that is not a requirement for using graph or renderer packages.
