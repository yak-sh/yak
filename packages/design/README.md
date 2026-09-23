# @yaks/design

Defines graph components and tools for design proposals, reviews, and accepted
architecture documentation. The proposal text is a `doc{title, body}` component
from [@yaks/doc](../doc) on the same entity (a record identified by
`entity.eid`).

- `design{}` marks a proposal.
- `review{verdict}` — approved, rejected, or changes requested.
- `architecture{}` marks a description of the current system architecture. It
  declares `governed: true`, so [@yaks/project](../project)'s health check
  reports it if no project can reach it through filing or containment
  relationships.

Who proposed it and who decided are [@yaks/kernel](../kernel)'s `proposed` and
`decided` components — anything can be proposed.

## Exports and setup

The root import exports `designDoc`, the JSON Schema document.
`@yaks/design/vocab` exports that document and `docs: [designDoc]`.
`@yaks/design/tools` exports `runs()`, the tool implementation factory. There is
no database or background job in this package.

For the commands below, use a [yak configuration](../cli/README.md) that loads
`@yaks/design`, `@yaks/doc`, `@yaks/kernel`, and `@yaks/alias`; load
`@yaks/project` as well to file a proposal under a project. The CLI loads the
vocabulary and tool implementations from their subpath exports.

```sh
yak design new 'Use an append-only audit log' 'Record each committed change.'
# Use the proposal id returned by the first command:
yak design decide <proposal-id> approved
```

## Tools

- `design new <title> [body]` — creates a `design{}` component, a
  `doc{title, body}` beside it, and the `proposed` component.
- `design decide <design> [verdict]` — writes `decided{verdict}`, defaulting to
  `approved`; the other decision value is `declined`. This is distinct from the
  three review verdicts above. It does not automatically add `architecture`.

Neither tool writes who decided or when: those properties are stamped from the
caller, so a decision an agent made is recorded as the agent's, and as an
owner's only when the owner is the one calling.

## Compatibility

Deno and Node — a JSON document plus two tool implementations, with no runtime
calls.
