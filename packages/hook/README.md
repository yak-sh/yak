# @yaks/hook

An event another system delivered.

`hook{source, event, payload, spool_id, received_at, method, path, headers,
sig_ok}`
— the body as it arrived, the route it came in on, and whether the sender signed
for it.

An unsigned hook is still recorded: the reader decides what to trust.

## Compatibility

Deno and Node — a JSON document, no runtime calls.
