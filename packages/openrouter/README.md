# @yaks/openrouter

OpenRouter model access through `@yaks/model`. Text requests use its stateless
Responses API, including streaming text and function calls. Alibaba models with
documented explicit caching use Chat Completions. A request whose model row asks
for image or audio output uses Chat Completions instead. A model listed in
`speech` uses OpenRouter's binary speech endpoint. The text and chat routes
accept image input and report usage, and the dollars OpenRouter says each
request cost as the reply's `cost`. They share media decoding and SSE parsing
with `@yaks/openai`, but use only OpenRouter credentials.

This fragment assumes `myPrivateKey` was obtained from private application
configuration. Do not store it in graph entities or shared configuration files.

```ts ignore
import { responses } from '@yaks/openrouter'

let model = responses({ key: () => myPrivateKey })
let reply = await model({
  model: 'anthropic/claude-sonnet-4',
  items: [{ kind: 'user', text: 'Hello' }],
  tools: [],
})
```

Model identifiers are OpenRouter's opaque `vendor/model` strings. Choose one
available to your account. Tool use and image input depend on the selected
model. There is no automatic model fallback or rewriting of identifiers.

## Generated media

Set `model.modalities` to the output modes the model serves, for example
`["text", "audio"]` on Lyria. The session runner carries that into the request.
The local harness supplies the graph's `@yaks/blob` artifact store to this
adapter. Direct callers supply `media: { store }`. Audio uses OpenRouter's
streamed Chat Completions output; MP3 is the default format, and `media.audio`
can choose another documented format or a voice where the model supports it.
`speech: ['bytedance-seed/seed-audio-1-0']` sends that model's latest user text
to `/api/v1/audio/speech` and stores the returned MP3 bytes. Speech requests
need a media store and answer with an artifact, without a text reply. Image
output uses Chat Completions' `message.images` data URLs. Decoded bytes are
checked and stored before the reply returns; `reply.artifacts` carries addresses
and media types, never the encoded payload.

The two Lyria rows use `google/lyria-3-clip-preview` and
`google/lyria-3-pro-preview`, served by the `openrouter` provider. Neither
supports function tools. A media request sends the conversation and requested
modalities without tool declarations.

## Exports and stored data

The root module exports `responses`, its `Options` type, and `openrouterDoc`,
the schema for `openrouter{response_id}`. `./vocab` exports that document and
its `docs` list. The adapter returns replies without storing them; the session
runner can use its `mark(reply)` result to store response metadata in the graph.

## Signing in

Signing in to OpenRouter is a connection through the built `openrouter`
integration of [@yaks/connections](../connections). Its PKCE exchange answers an
API key rather than tokens, and the key is the connection's secret. The adapter
only takes the key, from `key()`. Revoking the key is an OpenRouter account
action.

## Context and failures

OpenRouter's documented Responses API is stateless. Every request includes the
complete applicable conversation. This adapter sends `store: false`, never
`previous_response_id`, and exposes no continuation anchor. It records
`openrouter{response_id}` for diagnostics only. Expect higher request bytes than
a provider supporting stored continuation, especially for forks.

The Responses transport retries transient failures before text reaches the
caller. It does not replay text delivered through `onText`, or retry a rejected
request such as HTTP 400. Cancellation uses `Request.signal`. Native
`image_generation` and `web_search` declarations are not enabled on text
requests; function tools remain available there.

## Prompt caching

Tool declarations are sorted by name, with schema object keys sorted
recursively. Array order is preserved. Instructions precede the transcript;
appending items never regroups or rewrites earlier messages.

Anthropic text requests mark the stable instruction prefix and the latest three
request-ending transcript boundaries with Responses `prompt_cache_breakpoint`.
OpenRouter translates these into five-minute `cache_control` breakpoints across
Anthropic-compatible upstreams. Prior boundaries remain explicit even when more
than 20 new blocks are appended; a trailing marker alone cannot look back far
enough. Cache hints may move as old boundaries roll out, not message content.

Alibaba's documented explicit-cache models use Chat Completions with per-block
`cache_control`, the same stable-prefix and rolling boundaries, streamed text
and tool calls. Unsupported snapshot models get no explicit directives. Other
upstreams retain their documented automatic caching. Gemini uses implicit
caching, not the separately billed explicit storage path.

`Request.conversation` becomes `session_id` on Responses and chat. OpenRouter
pins routing from the first successful request, before any observed cache hit;
the routing session expires after ten minutes of inactivity. Speech sends
`x-session-id` for observability grouping only, not sticky routing.

Cache hits still depend on upstream minimum prefix lengths, expiry, and exact
prefix matches. Anthropic makes a cache write available only once the response
begins, so concurrent cold-prefix requests do not guarantee cache hits.
`usage.cached_tokens` preserves reported reads (including zero); absent counts
stay unknown. OpenRouter reports cache writes too, but the shared `Usage` shape
has no cache-write property. This adapter does not invent one or treat writes as
cache reads. The provider-reported dollar cost is preserved.

Official protocol references:

- https://openrouter.ai/docs/api_reference/responses/overview
- https://openrouter.ai/docs/guides/best-practices/prompt-caching
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://openrouter.ai/docs/guides/overview/multimodal/audio
- https://openrouter.ai/docs/guides/overview/multimodal/tts
- https://openrouter.ai/docs/guides/overview/auth/oauth

Tests capture interface requests and use mocked responses, not paid provider
calls. They check reusable prefixes, cache boundaries beyond the lookback
window, streamed text/tool assembly, reported usage, cancellation, errors, and
media.
