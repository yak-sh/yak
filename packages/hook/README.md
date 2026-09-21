# @yaks/hook

An event another system delivered.

The component is
`hook{source, event, payload, spool_id, received_at, method, path, headers, sig_ok}`:
the body as it arrived, the route it came in on, and whether the sender's
signature verified.

An unsigned hook is still recorded; whoever reads it decides what to trust.

## Compatibility

Deno and Node — a JSON document, with no runtime calls.
