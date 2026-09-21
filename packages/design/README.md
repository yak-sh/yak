# @yaks/design

What was proposed, and what stands.

- `design` — a proposal written down so it can be argued with.
- `review{verdict}` — approved, rejected, or changes requested.
- `architecture` — the description that stands once a design is decided. It is
  declared `governed: true`, so a project's reach is computed over it.

Who proposed it and who decided are [@yaks/kernel](../kernel)'s `proposed` and
`decided` components — anything can be proposed.

## Tools

- `design new <title> [body]` — writes the proposal down: a `design{}`
  component, a `doc{title, body}` beside it, and the `proposed` component.
- `design decide <design> [verdict]` — records the decision, `approved` unless
  another verdict is given.

Neither tool writes who decided or when: those columns are stamped from the
caller, so a decision an agent made is recorded as the agent's, and as an
owner's only when the owner is the one calling.

## Compatibility

Deno and Node — a JSON document plus two tool implementations, with no runtime
calls.
