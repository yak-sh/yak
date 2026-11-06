# @yaks/anthropic

Anthropic's Messages API as an `@yaks/model` model, spoken over `fetch` with no
SDK, so a Worker that bundles it uploads only the few kilobytes it runs. Model
names are Anthropic's own: `claude-sonnet-5-5`, `claude-opus-5-5`,
`claude-haiku-5-5`.

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
  `cache_control`, so each request reads the prefix the last one wrote. It is
  kept five minutes, or an hour (`ttl: "1h"`, written at twice the input price
  where five minutes cost 1.25 times) when `Request.cacheRetention` is 3600 or
  more; the reply's `cacheExpiresAt` is the request's start plus that lifetime.
- `Request.tokens` is `max_tokens` (64,000 without it); `Request.effort`, when
  it is one of `low`, `medium`, `high`, `xhigh`, `max`, is
  `output_config.effort`. Thinking is left to the model's default.

- `web: true` (the provider's default, unless its options or `HARNESS_WEB=0`
  turn it off) offers the API's own web search and page fetch after the tools:
  `web_search_20260209` and `web_fetch_20260209`, which filter what they read
  before it reaches the context, to the models that have them, and the plain
  `web_search_20250305` and `web_fetch_20250910` to older ones. Each is used at
  most four times a request and a fetched page is cut at 25,000 tokens, so the
  model says the most a request can add (`hosted`: four searches, and 160,000
  tokens read back, taking a search's results as 15,000, which the API does not
  cut) for a meter to reserve. The API runs them within the request; nothing
  comes back as a call.

Text deltas reach `onText` as they arrive. `onSubmit` runs before the POST and
`onAck` with `anthropic{response_id}` on the stream's first event. `signal`
stops the stream; the stop is thrown as the signal's reason, not a `ModelError`.
The reply's items are its text and `tool_use` blocks, in order. Text runs on as
one item across the blocks its citations split it into and the searches and
fetches between them, and each web page it cites is linked after the text citing
it, as `[title](<url>)`. Thinking blocks and the API's own tool blocks are not
kept, and the next request is sent without them, which the API accepts. A turn
the API paused (`pause_turn`) answers with what it said.

`usage` names input as Anthropic counts it plus what the cache read and wrote,
so `cached_tokens` and `cache_write_tokens` are parts of `input_tokens`, and the
searches it ran as `web_searches`, which a model's `web_search` price weighs (a
cent each at list price). A page fetch costs only the tokens it reads. The API
reports no dollars: a caller weighs usage at the model row's price.

## Failures

Nothing is retried here; the caller retries, since a retry here could buy one
request twice. A rate limit, an overloaded or failing server, or a dropped
connection is a `ModelError` coded `busy`, with `retry.after` from
`Retry-After`; so is an `error` event mid-stream that names one, and a stream
that ends before its message does. A refused key is `key`, an unknown model
`model`, a spent credit balance `credit`, any other refused request `request`,
and a `refusal` stop `refusal`. A spent credit balance is never `limit`, the
code of a caller's own ceiling: the key's account running dry is a failure for
whoever holds the key. Typed questions and image or audio output are refused
before anything is sent.

## Models and prices

`info(name)` reads the model from `/v1/models` for its context window and gives
the price `@yaks/model`'s `listPrice` has for the name (the API publishes none);
`list()` does the same for every model the key can use. `mark(reply, cache)`
writes `anthropic{response_id, cache_expires_at}`, the expiry being the
request's start plus the documented five minutes. `anthropicDoc` declares the
component.
