# @yaks/openai

An OpenAI Responses API client and an adapter for `@yaks/model`. The client
handles streamed responses, credentials, retries, and errors; the session
package handles transcript persistence.

## Install

```sh
deno add jsr:@yaks/openai
```

## Use

```ts
import { credential, responses } from '@yaks/openai'

let model = responses({
  credential: credential(Deno.env.get, Deno.readTextFile),
})
let reply = await model({
  model: 'your-model-id',
  items: [{ kind: 'user', text: 'hi' }],
  tools: [],
})
```

`credential` looks in the environment (`OPENAI_API_KEY`, the public API) and
then in the Codex CLI's `auth.json` (`TASKS_CODEX_HOME`, `CODEX_HOME`,
`~/.local/state/tasks/codex`, `~/.codex`), whose OAuth tokens reach the Codex
backend under their account. How a file is read is handed in, so the package
runs wherever `fetch` does.

Every request streams and is read to its end; only the completed items come back
as neutral items. `store` is `false` unless asked for: the Codex backend refuses
anything else. What the API keeps about a reply is this package's own comp,
`openai{response_id}` (`openaiDoc`, stamped by the model's `mark`); with `store`
on, `anchor` reads it back so the next request continues from the reply with
only what followed, and without it `anchor` answers nothing and a caller replays
the conversation.

A refusal the API named, a missing credential, and a transport that never
connected are `ModelError`s. Anything else thrown is a defect.

## Provider-native transport

`responses` adapts the shared `transport` to neutral model items. A caller that
needs encrypted reasoning replay, usage, rate limits, unknown provider events,
or partial failure evidence can use that same wire directly:

```ts
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
for every transient wire failure — a connection that never landed, a body that
dropped, a stream that ended with no completion, a 5xx or 429, and any fault
whose provider `code` names capacity (`server_is_overloaded`, `server_error`,
`overloaded`, `overloaded_error`, `rate_limit_exceeded`) whatever its status.
Auth and validation refusals fail fast. `Retry-After` extends the backoff, up to
60s. One refresh on 401 when supplied. `retries` and `pause` configure the
backoff. `shape` replaces the default request shaping for compatible providers;
otherwise requests always stream, default to `store: false`, and request
encrypted reasoning. `reach()` probes `/models` with a five-second timeout: any
HTTP answer proves connectivity, not authorization.

Native failures are `ResponseError`s with a stable `kind` and optional provider
`code` (the error body's or event's `code`, or its `type` when the code is
null), HTTP `status`, rate `limits`, and partial `items`/`evidence`. The Model
adapter maps these to `ModelError`s and defaults to no retries. It accepts the
same transport policies plus `refresh`, `signal`, and `event`; its `store` and
anchor behavior is unchanged. `frames(stream)` exposes the same SSE decoder
without transport policies or redaction and releases its reader on exit.

Completed Responses usage is returned as provider-neutral `Reply.usage` and
persisted by the session on the ask entry's `usage` component. Counts include
input, output, total, cached input, and reasoning output tokens when reported.
Cached tokens are part of input, and reasoning tokens are part of output;
neither should be added again. Missing counts remain unknown, not zero. The
provider does not report a cache expiration timestamp here; a cache hit records
past reuse, not a promise that the next request will hit the cache.

## Native image generation

Image generation is opt-in. Supply an external binary store through the existing
`@yaks/blob` backend interface:

```ts
import { artifactStore, fileBlobs } from '@yaks/blob'
import { responses } from '@yaks/openai'

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
was saved. Failed graph admission after a successful external write can leave an
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

Reference: https://developers.openai.com/api/docs/guides/tools-web-search
