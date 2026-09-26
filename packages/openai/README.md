# @yaks/openai

An OpenAI Responses API client and an adapter for `@yaks/model`. The client
handles streamed responses, credentials, retries, and errors. It does not open a
database or persist conversations. Applications can call it directly, or use
`@yaks/session` to save requests, replies, usage, and response IDs in a graph.
Optional generated images are written through a storage callback supplied by the
application.

## Exports

- `responses(options)` returns a provider-neutral `Model` from `@yaks/model`.
- `transport(options)` returns the lower-level Responses client, with `run()`
  and `reach()` methods. `frames(stream)` decodes server-sent events (SSE).
- `credential`, `fromEnv`, `fromCodex`, and `codexPaths` read or locate
  credentials through application-supplied environment and file functions.
  `OPENAI` and `CODEX` identify the two default endpoints.
- `input`, `body`, and `items` convert between model requests/replies and
  Responses API data. `ResponseError` describes transport failures; exported
  types describe options, credentials, events, results, usage, and images.
- `openaiDoc` and `OPENAI_COMP` describe the `openai{response_id}` component.
  `@yaks/openai/vocab` exports `openaiDoc` and `docs` for schema loading.

## Install

```sh
deno add jsr:@yaks/openai
```

## Use

```ts ignore
import { credential, responses } from '@yaks/openai'

let model = responses({
  credential: credential(Deno.env.get, Deno.readTextFile),
  web: false, // Enable provider-hosted search when the application needs it.
})
let reply = await model({
  model: 'your-model-id',
  items: [{ kind: 'user', text: 'hi' }],
  tools: [],
})
console.log(reply.items)
```

`credential` checks `OPENAI_API_KEY` first. It then checks `auth.json` in
`TASKS_CODEX_HOME`, `CODEX_HOME`, `$XDG_STATE_HOME/tasks/codex`,
`~/.local/state/tasks/codex`, and `~/.codex`, in that order, skipping absent
roots and unreadable or unusable files. API keys use the public API; Codex OAuth
tokens use the Codex backend with their account ID. The application supplies
file and environment access, so the client itself needs only web-standard APIs.

Every HTTP request streams and is read to the end. The returned reply contains
completed model items. Supply `request.onText` to receive text deltas while the
request runs. Reasoning and other provider-specific items are available through
the lower-level transport rather than the neutral model item list.

`store` defaults to `false`. The model's `mark(reply)` returns
`openai{response_id}` for the caller to persist; it does not write the graph
itself. With `store: true`, `anchor(components)` returns that ID so a session
can continue from a stored response and send only subsequent context. Without
storage, `anchor` returns nothing and the caller replays the conversation. The
Codex backend requires `store: false`.

Operational transport failures are mapped to `ModelError`, except a provider
`invalid_request_error`, which remains a `ResponseError` so callers can inspect
invalid request history. Other exceptions, including application callback
failures, propagate unchanged.

## Provider-native transport

`responses` adapts the shared `transport` to neutral model items. A caller that
needs encrypted reasoning replay, usage, rate limits, unknown provider events,
or the details of a partial failure can use that same HTTP transport directly:

```ts ignore
import { credential, transport } from '@yaks/openai'

let client = transport({
  credentials: {
    get: credential(Deno.env.get, Deno.readTextFile),
    // refresh: renewBearer, // invoked at most once after a 401 per run
  },
  stallMs: 60_000,
  redact: true,
})
let result = await client.run({ model: 'your-model-id', input: [] }, {
  // signal: controller.signal,
  event: (frame) => {
    if (frame.type == 'response.output_text.delta') {
      // A transient delta; completed items come back in result.items.
    }
  },
})
```

The watchdog covers connection, first frame, and gaps between frames (also an
HTTP error body). Each frame resets it; `0` (the default) disables it. Caller
cancellation stays an abort, not a stall. The frame hook runs after redaction,
before terminal-item collection; it includes unknown events too. The transport
reads through EOF and requires a completed response naming its serving model.

Redaction is opt-in: it scrubs credential token/account values from provider
frames and HTTP error reasons, remembers old credentials across refresh and
later runs, and hides credential-loader exception messages. It is not a general
PII filter. Observation vocabulary is not part of this package.

The native transport defaults to two bounded retries for credential loading and
for transient request failures: an unestablished connection, a truncated body, a
stalled stream, a stream ending without completion, a 5xx or 429, and any
failure whose provider `code` indicates capacity (`server_is_overloaded`,
`server_error`, `overloaded`, `overloaded_error`, `rate_limit_exceeded`)
whatever its status. Auth and validation refusals fail fast. `Retry-After`
extends the backoff, up to 60s. One refresh on 401 when supplied. `retries` sets
the attempt limit and `pause` supplies the delay function. `patienceMs` can
extend HTTP retries beyond that limit; its default of zero keeps the attempt
limit. `run(request, { noRetry: true })` prevents replay of a dispatched
exchange. `shape` replaces the default request shaping for compatible providers;
otherwise requests always stream, default to `store: false`, and request
encrypted reasoning. `reach()` probes `/models` with a five-second timeout: any
HTTP answer proves connectivity, not authorization.

Native failures are `ResponseError`s with a stable `kind` and optional provider
`code` (the error body's or event's `code`, or its `type` when the code is
null), HTTP `status`, rate `limits`, and partial `items`/`evidence`. The model
adapter uses the same retry defaults, but disables HTTP replay when the request
has an `onText` callback, preventing duplicate streamed text. It accepts the
transport policies plus `refresh`, `signal`, and `event`; error mapping and
continuation behavior are described above. `frames(stream)` exposes the same SSE
decoder without transport policies or redaction and releases its reader on exit.

Completed Responses usage is returned as provider-neutral `Reply.usage` and
persisted by the session on the model-request entry's `usage` component. Counts
include input, output, total, cached input, and reasoning output tokens when
reported. Cached tokens are part of input, and reasoning tokens are part of
output; neither should be added again. Missing counts remain unknown, not zero.
The provider does not report a cache expiration timestamp here; a cache hit
records past reuse, not a promise that the next request will hit the cache.

## Native image generation

Image generation is opt-in. Supply an external binary store through the existing
`@yaks/blob` backend interface:

```ts
import { artifactStore, fileBlobs } from '@yaks/blob'
import { responses } from '@yaks/openai'

const apiKey = Deno.env.get('OPENAI_API_KEY')!
const model = responses({
  credential: () => ({ token: apiKey, base: 'https://api.openai.com/v1' }),
  images: {
    tool: { output_format: 'png', quality: 'auto' },
    store: artifactStore(fileBlobs('/private/artifacts')),
  },
})
```

The option adds OpenAI's native `image_generation` tool alongside function
tools. It is not a function tool implemented by the application. Use a Responses
model that supports it (for example `gpt-4.1`), with API access to image
generation. The adapter does not assume every model or the Codex subscription
endpoint supports the tool. See the current
[OpenAI image generation guide](https://developers.openai.com/api/docs/guides/tools-image-generation)
for model availability, permissions, settings, and pricing.

Completed `image_generation_call` items are decoded, checked against a default
32 MiB per-image limit and their PNG/JPEG/WebP signature, then persisted before
returning the reply. `reply.artifacts` contains addresses and metadata, never
base64. Partial or incomplete images are not published. Image payloads are
removed from the adapter's event callback, including nested completion events.
The low-level transport is still a raw protocol interface: consumers using it
directly must not log raw image events.

The check validates format signatures, not full image decoding. Dimensions are
not inferred. A storage error fails the response rather than claiming an image
was saved. A failed graph write after a successful external write can leave an
unreferenced blob; cleanup is not automatic. No live-provider generation was
used in the automated tests.

When `images` provides a storage callback, the tool is offered on every request,
including OAuth, unknown models, and custom endpoints. Omitting `images`
disables it. The legacy `auto` option is deprecated and ignored; it no longer
filters models or endpoints. The server decides whether the tool is supported.

Provider errors propagate without a speculative retry that removes the tool.
There is no reliable structured capability-rejection contract across these
endpoints, so the adapter does not infer support from error-message substrings
or cache negative observations. No paid capability probes are performed.

## Hosted web tools

`responses()` offers OpenAI's native `web_search` tool by default, alongside
function and image tools. Set `web: false` to disable it. The provider executes
search actions; supported reasoning models can also open pages (`open_page`) and
find text within them (`find_in_page`). There is no separate generic fetch tool
in this integration. These actions do not run as local function calls.

Final response URL citations are preserved as clickable Markdown source links.
During streaming, source links become available when the final response arrives.
Provider/model support and account permissions still apply; an unsupported-tool
error is reported rather than silently retrying without web access. This was
validated with mocked responses, not a paid live request.

See the
[OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search)
for provider behavior and supported models.
