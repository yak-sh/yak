# @yaks/anthropic

Anthropic's Messages API as an `@yaks/model` model, through the official
`@anthropic-ai/sdk`. Model names are Anthropic's own: `claude-sonnet-5-5`,
`claude-opus-5-5`, `claude-haiku-5-5`.

```ts ignore
import { messages } from '@yaks/anthropic'

let model = messages({ key: () => myPrivateKey })
let reply = await model({
  model: 'claude-sonnet-5-5',
  items: [{ kind: 'user', text: 'Hello' }],
  tools: [],
})
```

`key` is asked at the moment of each call, so a rotated key lands on the next
request. Take it from the vault (`reveal`), never from a graph row. The client
reads no credential and no base URL from the environment: `base` names another
root, `https://api.anthropic.com` by default.

## What is sent and read

A request becomes one streamed `POST /v1/messages`:

- `Request.instructions` and the `instruction` items before the conversation are
  the `system` prompt. An instruction later in the conversation is a text block
  in the turn it falls in.
- Items become messages; consecutive items of one role share a message, so the
  results of parallel calls answer together. A `call` is a `tool_use` block, a
  `result` a `tool_result`, an `image` a base64 image block.
- Tools are sent in name order and the request carries top-level
  `cache_control`, so each request reads the prefix the last one wrote.
- `Request.tokens` is `max_tokens` (64,000 without it); `Request.effort`, when
  it is one of `low`, `medium`, `high`, `xhigh`, `max`, is
  `output_config.effort`. Thinking is left to the model's default.

Text deltas reach `onText` as they arrive. `onSubmit` runs before the POST and
`onAck` with `anthropic{response_id}` on the stream's first event. `signal`
stops the stream; the stop is thrown as the SDK's abort, not a `ModelError`. The
reply's items are its text and `tool_use` blocks, in order; thinking blocks are
not kept, and the next request is sent without them, which the API accepts.

`usage` names input as Anthropic counts it plus what the cache read and wrote,
so `cached_tokens` and `cache_write_tokens` are parts of `input_tokens`. The API
reports no dollars: a caller weighs usage at the model row's price.

## Failures

The SDK does not retry (`maxRetries: 0`); the caller does, since a retry here
could buy one request twice. A rate limit, an overloaded or failing server, or a
dropped connection is a `ModelError` coded `busy`, with `retry.after` from
`Retry-After`. A refused key is `key`, an unknown model `model`, a spent credit
balance `credit`, any other refused request `request`, and a `refusal` stop
`refusal`. A spent credit balance is never `limit`, the code of a caller's own
ceiling: the key's account running dry is a failure for whoever holds the key.
Typed questions and image or audio output are refused before anything is sent.

## Models and prices

`info(name)` reads the model from `/v1/models` for its context window and gives
the price `@yaks/model`'s `listPrice` has for the name (the API publishes none);
`list()` does the same for every model the key can use. `mark(reply, cache)`
writes `anthropic{response_id, cache_expires_at}`, the expiry being the
request's start plus the documented five minutes. `anthropicDoc` declares the
component.
