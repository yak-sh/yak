# @yaks/page

A page as witnessed.

`web{url, frozen_at}` — the address that was read, and when its bytes were
frozen. A citation keeps its meaning after the page changes or disappears.

The bytes are an [@yaks/blob](../blob) artifact; the address is canonical, so
two readings of one page are one entity.

## Compatibility

Deno and Node — a JSON document, no runtime calls.
