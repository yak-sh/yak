# @yaks/openrouter

OpenRouter model access through its stateless Responses API. Implements
`@yaks/model`, including streaming public text, function calls/results, images
as input, cancellation, and reported token usage. It reuses the portable
Responses transport and parsing from `@yaks/openai`, but does not use OpenAI
credentials, enable OpenAI native tools, or write OpenAI response metadata.

```ts
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

## Browser authorization

`@yaks/openrouter/oauth` provides `authorization({store, fetch?, now?})` with
`begin()`, `complete(returnUrl)`, `cancel()`, and `token()`. `begin` produces an
OpenRouter authorization URL using PKCE S256. Complete it by pasting the
browser's return URL. Each attempt has a unique loopback callback path, expires
after ten minutes, and is consumed after an exchange attempt. The browser may
show a connection-refused page because this flow does not open a callback
listener. Copy that page's URL. Restarting requires beginning authorization
again.

OpenRouter exchanges the code for an **API key**, not an OAuth access/refresh
pair. That key is stored privately; there is no refresh token and no inferred
expiry. `@yaks/openrouter/host` supplies `fileAuthorization(path)`, using the
same private, locked JSON file storage as MCP authorization. Files are plaintext
with 0600 permissions and atomic replacement; they are not encrypted. Revoking
the key is an OpenRouter account action. Authorization never initiates
generation.

The common store and expiring-attempt types live in `@yaks/oauth`. MCP discovery
and registration remain in `@yaks/mcp-client`; OpenRouter key exchange stays
here.

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

Tests use mocked responses and authorization exchanges, not paid provider calls.
