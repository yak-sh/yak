# MCP output contracts

The public connector exposes a fixed platform roster. Each platform tool now
advertises an object output schema and returns its human-readable response as
`structuredContent.text`, while retaining the original text content block. This
includes notifications and usage guidance appended to the narrative.

Existing structured fields remain at their original paths so app views keep
working. `tool_outputs.ts` describes app and space listings, declared commands,
error cards, domain DNS/provisioning records, and visitor statistics. The guide
retains its declared `page` and `markdown` fields. Text-only operations promise
text, not parsed entities that their implementation does not actually return.
Errors remain MCP tool errors, not successful objects with invented fields.

App commands do not add dynamic MCP tool names. They are discovered by
`commands` and invoked by `command`. Query rows depend on each app's vocabulary,
so the command schema describes `rows`, or write `entities` and `aliases`, while
allowing app-defined result fields. It does not claim a fixed row schema across
all apps. Likewise, arbitrary application record fields remain open in generic
graph tools. The public protocol is still useful and truthful without guessing
schema from one response example.

The reusable graph Tool contract also supports raw JSON Schema `outputSchema`.
`@yaks/mcp` preserves it on listing and validates structured successes. Hosted
platform tools use the existing Zod output integration, so MCP validates their
success results too. See `packages/mcp/README.md` for the result wrapper rules.

Validation uses an isolated in-memory MCP server and application stores, not
live mutations. The roster coverage test checks every platform tool has a
nonempty object schema, and invocation tests validate returned structured
content with the published schemas. Remote directory caches may need a refreshed
connector submission to see updated tool descriptions.
