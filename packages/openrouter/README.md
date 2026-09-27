# @yaks/openrouter

OpenRouter model access through `@yaks/model`. Text requests use its stateless
Responses API, including streaming text and function calls. A request whose
model row asks for image or audio output uses Chat Completions instead. Both
routes accept image input and report usage. They share media decoding and SSE
parsing with `@yaks/openai`, but use only OpenRouter credentials.

This fragment assumes `myPrivateKey` was obtained from private application
configuration. Do not store it in graph entities or shared configuration files.

```ts ignore
import { responses } from '@yaks/openrouter'

const model = responses({ key: () => myPrivateKey })
const reply = await model({
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
Image output uses Chat Completions' `message.images` data URLs. Decoded bytes
are checked and stored before the reply returns; `reply.artifacts` carries
addresses and media types, never the encoded payload.

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

Streaming Responses calls retain the shared transport's no-retry behavior.
Cancellation uses `Request.signal`. Native `image_generation` and `web_search`
declarations are not enabled on text requests; function tools remain available
there.

Official protocol references:

- https://openrouter.ai/docs/api_reference/responses/overview
- https://openrouter.ai/docs/guides/overview/multimodal/audio
- https://openrouter.ai/docs/guides/overview/auth/oauth

Tests use mocked responses, not paid provider calls.
