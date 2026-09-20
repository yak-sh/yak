# @yaks/design

What was proposed, and what stands.

- `design` — a proposal written down so it can be argued with.
- `review{verdict}` — approved, rejected, or changes requested.
- `architecture` — the description that stands once a design is decided; a
  governed facet, so a project's reach is computed over it.

Who proposed it and who decided are [@yaks/kernel](../kernel)'s `proposed` and
`decided` marks — anything can be proposed.

## Tools

- `design new <title> [body]` — the proposal written down: `design{}`, the words
  beside it, and the `proposed` mark.
- `design decide <design> [verdict]` — the decision, `approved` unless said.

Neither writes who or when: those columns are stamped from the caller, so a
decision an agent made is recorded as the agent's and an owner's only when the
owner is the one asking.

## Compatibility

Deno and Node — a JSON document, no runtime calls.
