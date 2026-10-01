# @yaks/workers-ai

Cloudflare Workers AI as an `@yaks/model` model, through the `AI` binding a
Worker is given. The binding is the authorization: there is no API key, no
endpoint and nothing to sign in to. Outside a Worker there is no binding, and so
no model.

```ts
import { type Binding, workersAi } from '@yaks/workers-ai'

// `ai` is a Worker's `env.AI`: the binding its Wrangler configuration names.
const hello = async (ai: Binding) => {
  const reply = await workersAi(ai)({
    model: '@cf/zai-org/glm-5.3-flash',
    items: [{ kind: 'user', text: 'Hello' }],
    tools: [],
  })
  return reply.items
}
```

Model identifiers are Workers AI's own `@cf/…` names. Tool use depends on the
model you choose.

## What is sent and read

A request becomes one
`run(model, {messages, tools, max_tokens, reasoning_effort})` call. Instructions
and `instruction` items are `system` messages, a call joins the assistant
message it follows as a `tool_calls` entry in OpenAI's shape
(`{id, type: 'function', function: {name, arguments}}`, which GLM requires), and
a result is a `tool` message naming the call it answers. `Request.tokens` is
sent as `max_tokens`; without it the model's own default applies, and so does
`Request.effort`, sent as `reasoning_effort` (GLM's `low`, `high`, `max`).

Models in the catalog answer one of two shapes, and both are read: the binding's
own (`response`, and a flat `tool_calls` of `{name, arguments}`) or OpenAI's
chat completion (`choices[0].message`). A third-party model such as Jev answers
inside AI Gateway's envelope, `{state, result}` (with optional
`gatewayMetadata`), and `said()` takes its `result` out before anything is read.
A call that arrives without an id is given one derived from the reply's, so a
result can always name its call. `usage.prompt_tokens`, `completion_tokens`,
`total_tokens` and `cached_tokens` become the reply's usage; a count the model
leaves out stays unknown. Cached counts also come from
`usage.input_tokens_details.cached_tokens` or
`usage.prompt_tokens_details.cached_tokens`.

`usageOf(answer)` is that reading, exported, for whoever holds a raw answer from
the binding (a meter counting a call made without this package): it reads a chat
model's `prompt_tokens` and `completion_tokens`, and the `input_tokens` and
`output_tokens` a structured model reports.

## Typed questions

A request carrying `questions` goes to a structured model such as Jev
(`typesafe/jev`) as `run(model, {state, questions})`: the chat messages above
are the state, and the questions are sent as they were asked. The reply has no
items; its `answers` are the model's, by question name, each keeping `type`,
`noul`, `choice`, `score`, `confidence` and `probabilities`. A chat model asked
questions refuses them at the binding. A reply that carries no `answers` is one
this package cannot read, and throws a plain `Error`: a defect to report, not a
refusal to expect.

The whole reply arrives at once, so `onText` is called once with all of its
text. `signal` is checked before the call and after it; the binding call itself
cannot be interrupted.

## Context and failures

Workers AI keeps nothing between requests. Every request carries the whole
conversation, and the model has no `anchor`, `mark` or `vocab`. A request's
`conversation` is forwarded as
`run(model, input, {extraHeaders: {'x-session-affinity': conversation}})`, so
supported models can reuse their cached prefix. Tool definitions are ordered by
name without changing the caller's array. Affinity improves routing; it does not
guarantee a cache hit, nor add caching to a model that does not support it.

A rate limit or a model at capacity throws `ModelError` with code `busy` and the
binding's own message. Credits the account has spent (a partner model such as
Jev is paid from prepaid AI Gateway credits) throw one coded `limit`, a ceiling
asking again would meet too. An image item throws `ModelError` with code
`image`, since images are not sent. A `ModelError` the binding throws itself (a
binding that meters its caller, say) and anything else it throws are passed on
as they were thrown.

Tests use a stand-in binding, not paid inference.

## Music artifacts

`workersAi(binding, {media: {store}, fetch?})` supports the Workers AI music
response (`{audio: HTTPS URL}`, optionally inside Gateway's `result`). The
provider fetches it without credentials, bounds it by `media.maxBytes` (64 MiB
default), validates its format and persists it through `ArtifactStore`. The
reply carries `artifacts` with an audio call id and `cost` in dollars. Missing
storage refuses before inference.

`music(model)` distinguishes music request schemas from chat. ElevenLabs
`elevenlabs/music-v2` gets a text prompt, a 30-second request and MP3 output.
MiniMax `minimax/music-2.6` gets a text prompt and its required lyrics and
instrumental flags. The model's own id is sent to `binding.run`; this package
seeds no model rows or allowed-model catalogue.

Cloudflare's published tariffs are $0.0025 per output audio second for
ElevenLabs, and $0.15 per track plus $0.01 when MiniMax generates lyrics.
`audioSeconds(bytes)` measures MP3 layer III frame duration, including variable
bitrate; `audioPrice(model, input, seconds)` prices it.
`pricedAudio(model, input, answer, {fetch?, signal?, maxBytes?})` fetches and
returns `{bytes, mediaType, cost}` for hosts metering a raw binding response.
Audio is never priced as estimated text tokens. A host debits `Reply.cost`
against its existing account budget; this adapter introduces no allowance.
