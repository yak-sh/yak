# @yaks/openai

**OpenAI's Responses API as a [@yaks/model](../model) `Model`.**

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
  model: 'gpt-6-astra',
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
let result = await client.run({ model: 'gpt-6-astra', input: [] }, {
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
PII filter. Tasks enables it in its adapter. Observation vocabulary is not part
of this package.

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
