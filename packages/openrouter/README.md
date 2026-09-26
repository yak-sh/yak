# @yaks/openrouter

OpenRouter model access through its stateless Responses API. Implements
`@yaks/model`, including streaming public text, function calls/results, images
as input, cancellation, and reported token usage. It reuses the portable
Responses transport and parsing from `@yaks/openai`, but does not use OpenAI
credentials, enable OpenAI native tools, or write OpenAI response metadata.

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

Streaming calls retain the shared transport's no-retry behavior. Cancellation
uses `Request.signal`. Native `image_generation` and `web_search` declarations
are not enabled; function tools (including MCP tools) remain available. No
special OpenRouter plugin or native-tool configuration is implemented yet.

Official protocol references:

- https://openrouter.ai/docs/api_reference/responses/overview
- https://openrouter.ai/docs/guides/overview/auth/oauth

Tests use mocked responses, not paid provider calls.
