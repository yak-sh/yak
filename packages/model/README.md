# @yaks/model

Defines provider-neutral model request and reply types, vocabulary for providers
and models, and helpers for billing and recovering generated media. Use it
between a conversation and a provider adapter. It implements no provider's
transport; `@yaks/model/step` carries one model step from one host to another's
providers.

## Model interface

A **provider** is a service that runs models, described by the `provider`
[component](../graph/README.md#data-model). A **model** is what serves a model
request, independent of its provider; the `model` component describes it, and
`Model` is its callable TypeScript interface.

A **model request** (`Request`) is the model name, conversation items, tool
descriptions and options passed to `Model`. A **reply** (`Reply`) is the
provider's id, the model that served the model request and the items it
produced. An **item** (`Item`) is one input or output: `instruction`, `user`,
`assistant`, `image`, `call` or `result`. For example,
`{ kind: 'user', text: 'Hello' }` is an item.

```ts
import type { Model } from '@yaks/model'
import { equal } from '@yaks/testing'

const model: Model = async (request) => ({
  id: 'reply-1',
  model: request.model,
  items: [{ kind: 'assistant', text: 'Hello back' }],
})
const reply = await model({
  model: 'example',
  items: [{ kind: 'user', text: 'Hello' }],
  tools: [],
})
equal(reply.items, [{ kind: 'assistant', text: 'Hello back' }])
equal(reply.model, 'example')
```

`deferredModel(load, metadata)` constructs a model whose transport loads on its
first request or discovery call. Concurrent calls share that model; `mark`,
`vocab`, `anchor`, `lateResults` and `reads` (the media types it reads as they
are, beside text, each with the most bytes of one file) remain available
synchronously from `metadata`. Declare `info: true` or `recover: true` when the
provider supports those operations.

A provider is a plugin. Its package exports a `./provider` facet
(`ProviderFacet`): `providers(lent, options)` returns the models it serves,
keyed by the `provider.name` each serves under, built over what the host lends
(`Lent`: the shared `fetch`, the person's sign-in `key` and `refresh` by
integration, the artifact `store`, the host's `env` and, where the host keeps
them, the `receipts` an interrupted call is delivered from) and the plugin's
options from the config. `hosts(options)`, where a plugin offers it, names the
hosts those models call, so a host that puts a credential of its own in their
calls sends it nowhere else. `native(lent, options, spending)`, where a plugin
offers it, is the provider's own door (`Native`): one call as its API takes it,
held to what the host's `Spending` affords and settled at what it cost, for a
host that passes a caller's input through whole. A model priced by the call
rather than by its tokens quotes such a request itself (`Model.quote`). A model
whose provider runs tools of its own within a request (a web search, a page
fetch) says the most they add to one (`Model.hosted`: `searches`, and the
`input` tokens of what they read), which the provider enforces and a meter
reserves beside the request's own bound. A host running conversations
([@yaks/harness](../harness/README.md), the hosted model executor in
workers/model) asks every plugin its config names, so a config serves exactly
the providers it lists, and the host depends on none of them.
[@yaks/openai](../openai/README.md),
[@yaks/openrouter](../openrouter/README.md),
[@yaks/anthropic](../anthropic/README.md) and
[@yaks/claude](../claude/README.md) each export one.

## Install

```sh
deno add jsr:@yaks/model
```

## Exports

| Export              | Provides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/model`       | `listPrice`, `deferredModel`, `message`; `Offer`, `offers`, `offerFor`, `serving`; `Lent`, `ProviderFacet`; `Executor`, `Inference`, `InferenceHost`, `InferenceReceipt`, `FrozenModelRequest`, `infer`, `inferenceReply`, `frozenRequest`, `thawedRequest`; `Model`, `Request`, `Reply`, `Item`, `Tool`, `TextDelta`, `Question`, `Questions`, `Answer`, `Usage`, `Price`, `Mark`, `Answered`, `Listed`; `ModelError`; `models`, `modelDoc`, `addressed`, `requesting`, `confirmed`; `weigh`, `billed`, `limitEid`, `dollars`, `hourly`, `attribute`, `generated`, `merged`, `Paid`, `Part`; `submitted`, `acknowledged`, `submitCall`; `MediaReceipt`, `MediaReceipts`, `MediaRecord`, `mediaReceipts`, `receivedMedia`, `recoveredMedia`; component-name constants `PROVIDER`, `MODEL`, `TOOL`, `QUESTIONS`, `ANSWER`, `USAGE`, `PRICE`, `COST`, `RATE_LIMIT`, `RESPONSE` |
| `@yaks/model/vocab` | `modelDoc`, `docs`, `description`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@yaks/model/graph` | `plugins()`, returning `[models()]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@yaks/model/sse`   | `jsonFrames(body, fault, check?, done?)`: the JSON events of a server-sent event stream                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@yaks/model/stall` | `STALL_TIMEOUT`, `stallMs(req)`, `Stalled`, `watchdog(ms, clock?, stop?)`, `watched(fetch, ms)`, `watchedBody(body, ms)`: a request whose stream goes quiet fails as stalled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@yaks/model/step`  | `PATH`, `BEAT`, `answering(serve, report, clock?)`, `forwarding(lent, options?)`, `forwarded(graph, reach)`: one model step forwarded by one host and answered from the providers of another                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Items and delivery

An item's optional `from` names who supplied its words, independently of its
provider turn role. Prompt assembly calls `message(item)` before handing the
item to a provider. It renders `From <from>:` into text, tool output or a media
label and removes the metadata. The receiving model's own output needs no source
label. A user-role item can carry system context, a parent instruction, a helper
report or a tool refusal; its role does not make those the person's words.

```ts
import { message } from '@yaks/model'
import { equal } from '@yaks/testing'

equal(
  message({
    kind: 'user',
    from: 'your parent session',
    text: 'Read the file.',
  }),
  {
    kind: 'user',
    text: 'From your parent session:\nRead the file.',
  },
)
```

`Tool` describes a [tool](../graph/README.md#tools): its `name`, `description`
and JSON Schema `parameters`. A `call` item holds JSON arguments in `args`; a
`result` item answers that call by its `id`. The caller executes tools.

An `image` item holds `bytes`, `mediaType` and a textual `label`; a `document`
item holds the same for a document the model reads as it is, such as a PDF. The
caller resolves stored media into bytes before calling the model. A provider
adapter translates items into its protocol and determines which inputs it
supports, refusing a request with one it does not.

A **text delta** (`TextDelta`) is output text delivered to `Request.onText`; its
`index` identifies the final assistant item in `Reply.items`. It excludes
private reasoning and partial tool arguments. `Request.signal` cancels the model
request; adapters must implement propagation to their I/O. It does not cancel
independent tool processes.

```ts
import type { Item, Model, TextDelta, Tool } from '@yaks/model'
import { equal } from '@yaks/testing'

const tool: Tool = {
  name: 'double',
  description: 'Double a number',
  parameters: { type: 'object', properties: { n: { type: 'number' } } },
}
const items: Item[] = [
  { kind: 'instruction', text: 'Use double' },
  {
    kind: 'image',
    bytes: new Uint8Array([1]),
    mediaType: 'image/png',
    label: 'sample',
  },
  { kind: 'call', id: 'c1', name: 'double', args: '{"n":2}' },
  { kind: 'result', id: 'c1', output: '4' },
]
const deltas: TextDelta[] = []
const model: Model = async (request) => {
  equal(request.signal?.aborted, false)
  equal(request.items.at(-1), { kind: 'result', id: 'c1', output: '4' })
  request.onText?.({ index: 0, text: '4' })
  return {
    id: 'r1',
    model: request.model,
    items: [{ kind: 'assistant', text: '4' }],
  }
}
await model({
  model: 'example',
  items,
  tools: [tool],
  signal: new AbortController().signal,
  onText: (delta) => deltas.push(delta),
})
equal(deltas, [{ index: 0, text: '4' }])
```

`Request.instructions`, `effort` and `tokens` carry instructions, reasoning
effort and a reply token ceiling. `conversation` identifies the conversation for
provider caching. `input` carries explicit model-native inputs such as lyrics or
duration; providers validate supported inputs.

`Request.modalities` asks for `text`, `image` or `audio` output.
`Reply.artifacts` carries generated [artifacts](../blob/README.md), each with a
`call` and optional `revised_prompt`. These fields describe the interface;
[@yaks/openai](../openai/README.md) and
[@yaks/workers-ai](../workers-ai/README.md) implement provider calls.

```ts
import type { Model } from '@yaks/model'
import { equal } from '@yaks/testing'

const model: Model = async (request) => {
  equal(request.modalities, ['audio'])
  equal(request.input, { lyrics: 'Hello', duration: 5 })
  return {
    id: 'r1',
    model: request.model,
    items: [],
    artifacts: [{
      call: request.call!,
      address: 'stored-audio',
      media_type: 'audio/wav',
      size: 32,
    }],
  }
}
const reply = await model({
  call: 'c1',
  model: 'example',
  items: [],
  tools: [],
  modalities: ['audio'],
  input: { lyrics: 'Hello', duration: 5 },
})
equal(reply.artifacts?.[0].call, 'c1')
equal(reply.artifacts?.[0].media_type, 'audio/wav')
```

## Anchors and provider components

An **anchor** is an opaque provider reference to an earlier reply. With
`Request.anchor`, `items` contains only the items after that reply. Without an
anchor the caller supplies the needed items again. Anchors depend on the
provider retaining the earlier reply.

`Model.mark(reply)` returns provider-owned components (`Mark`) to attach to the
[entity](../graph/README.md#data-model) recording the reply. `Model.vocab`
declares them in a [vocabulary document](../vocab/README.md#vocabulary), and
`Model.anchor(components)` reads an anchor back. These optional members keep
provider-specific state out of the conversation interface.

```ts
import type { Model } from '@yaks/model'
import { equal } from '@yaks/testing'

const model: Model = Object.assign(
  async (request: Parameters<Model>[0]) => ({
    id: 'r1',
    model: request.model,
    items: [],
  }),
  {
    mark: (reply: { id: string }) => ({ example_response: { id: reply.id } }),
    anchor: (components: Record<string, unknown>) =>
      (components.example_response as { id?: string } | undefined)?.id,
    vocab: {
      $defs: {
        example_response: {
          component: true,
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    },
  },
)
const reply = await model({ model: 'example', items: [], tools: [] })
equal(model.anchor!(model.mark!(reply)), 'r1')
equal(model.anchor!({}), undefined)
```

## Providers and models in a graph

`modelDoc` declares `provider`, `model`, `serves`, `routes`, `usage`, `price`,
`cost`, `response`, `questions`, `answer` and `submitted{at}`. `models()`
supplies a graph [plugin](../graph/README.md#data-model) with that vocabulary,
name addressing and the `requesting` normalization
[hook](../graph/README.md#data-model). `@yaks/model/graph` exports the same
plugin through `plugins()`.

Provider and model names are each an
[identity](../vocab/README.md#identity-and-indexes). `addressed` resolves those
names to [eids](../graph/README.md#data-model); a name held by both a provider
and a model is refused. A **serves** component records a provider's offering of
a model on an [edge](../edge/README.md); `serves.name` is the name that provider
accepts, which may differ from `model.name`.

`requesting` replaces a name in `using.model` with its eid and creates an
unknown model with `offered: false` and `pending: {}` before admission resolves
references. `confirmed(provider,
name, listing?)` returns
[bundles](../graph/README.md#data-model) that remove `pending`, set
`offered: true`, and record the provider's serves edge.

```ts
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { graph, identityEid } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { nameKeywords } from '@yaks/names'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { confirmed, modelDoc, models } from '@yaks/model'
import { equal } from '@yaks/testing'

const using = {
  $defs: {
    using: {
      component: true,
      type: 'object',
      properties: { model: { type: 'string', ref: 'model', death: 'keep' } },
    },
  },
}
const vocab = loadVocab([kernelDoc, edgeDoc, modelDoc, using], [
  kernelKeywords,
  nameKeywords,
  edgeKeywords,
])
const g = graph({ storage: ram(vocab), vocab, plugins: [models()] })
await g.apply([{ entity: { eid: '$p' }, provider: { name: 'example' } }])
await g.apply([{ entity: { eid: 'request-1' }, using: { model: 'release' } }])
const eid = identityEid('model', ['release'])
equal((await g.get([eid]))[0].model, { name: 'release', offered: false })
equal(await g.address(['release']), new Map([['release', eid]]))
await g.apply(confirmed(identityEid('provider', ['example']), 'release', {
  name: 'release',
  context: 8192,
  price: { input: 1, output: 2 },
}))
const [offered] = await g.get([eid])
equal(offered.model, { name: 'release', context: 8192, offered: true })
equal(offered.pending, undefined)
equal(offered.price, { input: 1, output: 2 })
```

`provider.base` is its HTTP root URL and `provider.api` names the protocol, such
as `ollama` or `openai`. A **context window** is the token capacity for input
and reply together: `model.context` declares it, `provider.context` provides a
fallback, and `model.enforced` records a provider-enforced ceiling.
`model.modalities` declares requested outputs and `model.effort` the default
reasoning effort. This package declares those properties; consumers such as
[@yaks/session](../session/README.md) implement their use.

`Model.list()` returns provider model descriptions (`Listed`), and
`Model.info(name)` returns one description or `undefined`.

```ts
import type { Listed, Model } from '@yaks/model'
import { equal } from '@yaks/testing'

const listing: Listed = { name: 'release', context: 8192, modalities: ['text'] }
const model: Model = Object.assign(
  async (request: Parameters<Model>[0]) => ({
    id: 'r1',
    model: request.model,
    items: [],
  }),
  {
    list: async () => [listing],
    info: async (name: string) => name === listing.name ? listing : undefined,
  },
)
equal(await model.list!(), [listing])
equal(await model.info!('missing'), undefined)
```

## Usage, price and cost

**Usage** (`Usage`, `usage`) is token counts for one model request, and the web
searches its provider ran for it (`web_searches`). Cached input, input written
to the cache (`cache_write_tokens`, and of those the ones kept an hour,
`cache_write_1h_tokens`) and reasoning output are subsets of input and output,
not extra tokens; an absent count is unknown. **Price** (`Price`, `price`) is
dollars per million input, output and optional cached, cache-write and hour-long
cache-write tokens, and dollars per web search (`web_search`). **Cost** (`cost`)
is the dollars spent by one model request or tool call, with `reported` saying
whether the provider supplied that amount. A **rate limit**
(`rate_limit{provider, window, account, model, used, resets, at}`) is the latest
reading of how much of a provider's plan a window has used; with a `model`, of a
limit the plan sets on that model's requests alone, such as Claude's weekly cap
on Fable. Whoever hears a provider say so reports it as a
`Limit{provider, account, per, model, window, used, resets}` (a model on its
`Reply.limits`, or on the `ModelError.limits` of a refusal). A reader that hears
a limit on one model says `per: 'model'`, `metering(limits, model)` names the
model the request asked, and `limitRows(limits, at)` gives the rows that keep
them. `accountHome(runner, env)` is the directory of the account a CLI signs in
with, and `accountEid` its row.

## Routing a default

A **router** chooses which of several offerings a default runs on.
`route({routes, readings, now})` (`@yaks/model/route`) is pure: `routes` are the
offerings, each `{provider, model, name, plan, pinned}` with `plan` the provider
whose limits meter it, and `readings` are `rate_limit` rows. It answers
`{provider, model, why}`, or nothing where no rule can say. Each rule orders the
offerings it can speak for, best first, and the first rule that speaks for any
answers; `why` says in one line what it learned. There are two. A pinned
offering (`pinned`, the time it was pinned) is the answer whatever the plans
read. Otherwise the offerings whose plan has a reading are weighed, the one with
the most of its longest window left first, and a window that has reset since its
reading counts as unused. A parameter for a later rule (the work's kind) is
another property of what is asked.

In a graph the offerings are data: a **routes** edge from the row whose `using`
is the default to a `serves` edge, `routes{pinned}` on the one that is pinned,
and `provider{plan}` on a provider that spends another's plan. @yaks/harness
reads them for what a native session asks by default
([harness](../harness/README.md)).

A model a graph meets for the first time, by a request that names it or an
imported transcript, is given its vendor's list price (`listPrice(name)`), so
what Claude Code and Codex spent weighs in dollars without anyone writing a
price. The list is `prices.json`: Anthropic's and OpenAI's models, under the
names their transcripts use, from OpenRouter's public listing on the day it
names;
`deno run --allow-net=openrouter.ai --allow-write=packages/model bin/prices.ts`
fetches it again. A name's bracketed context window (`[1m]`) and release date
(`-20251001`) are dropped to find it. The price on a model's row is the one a
graph weighs at: change it there
(`price{input, output, cached, cache_write,
cache_write_1h, web_search}`,
dollars per million tokens and per search), and the list never writes over it.

`weigh(price, usage)` calculates dollars, treating missing counts as zero and
using the input price when the cached or cache-write price is absent.
`affordable(price, inputUpperTokens, remainingDollars, outputTokens?, searches?)`
returns the largest affordable output limit and its reserved dollars, or `null`,
reserving `searches` web searches beside the tokens. The input bound includes
provider framing, tools and retained conversation history; a token estimate is
insufficient. It reserves input at the highest applicable cache tariff, rounds
the maximum cost upward, and requires the provider to enforce the returned
output limit.

`promptBound(prompt, context, tools?)` is that bound for a text prompt and the
tools it declares, built before the call: twice their compact JSON's UTF-8 bytes
(a text token covers at least one byte; doubling covers a template's spaces and
indentation) plus `FRAMING` tokens, and never more than `context`. A prompt
carrying media is bounded by `context` alone; tools are declared as text, so an
argument named `document` or `image` is not media.
`requestBound(request,
context)` applies it to a `Request`'s instructions,
items, questions and input beside its tools, or gives `context` when an `anchor`
continues history the provider holds.

`retained(price, cacheRetention?)` is a request's price as it can be billed: a
provider keeps the longest cache lifetime it offers not over what the request
asks, or its default, so the hour's write tariff (`cache_write_1h`) applies only
to a request asking to keep its prefix an hour. A caller holds and charges a
request at this price.

`charged(reply, price, maximumReservedDollars)` settles reported dollars or
complete usage conservatively. Missing usage retains the reserved maximum;
unclassified input uses the highest cache tariff.

`billed(reply, price?)` uses `Reply.cost` first (provider-reported unless
`costReported: false`), then weighs usage if both usage and price exist, or
returns `undefined`.

A prompt is cached as a prefix in the order it is sent, so where a token sits
says how it was paid. `attribute(usage, parts)` lays a request's input parts out
in that order, scales their sizes to the reported input, and splits each into
`Paid` tokens: read from the cache, written to it, fresh, and generated.
`generated(tokens, parts)` splits output the same way by size, `merged` adds
splits together, and `dollars(price, paid, hour)` prices one.

```ts
import { billed, weigh } from '@yaks/model'
import { equal } from '@yaks/testing'

const price = { input: 1, output: 2, cached: 0.5 }
const usage = {
  input_tokens: 1_000_000,
  cached_tokens: 500_000,
  output_tokens: 250_000,
}
equal(weigh(price, usage), 1.25)
const reply = { id: 'r1', model: 'release', items: [], usage }
equal(billed(reply, price), { dollars: 1.25, reported: false })
equal(billed({ ...reply, cost: 3 }, price), { dollars: 3, reported: true })
equal(billed(reply), undefined)
```

## Typed questions

A **question** (`Question`) asks for a typed answer rather than prose. A
**noul** asks for a probability that its statement holds; a **choice** asks for
one criterion's name; a **score** asks for a number along ordered criteria.
`Questions` maps names to questions with `type`, `instructions` and optional
`criteria`. An **answer** (`Answer`) carries the corresponding `noul`, `choice`
or `score`, with optional `confidence` and `probabilities`.

`Request.questions` asks the questions and `Reply.answers` maps their names to
answers. The `questions.asked` component stores questions; the `answer`
component stores one answer with its `question` name. The interface does not
validate answers; adapters implement typed-question support.

```ts
import type { Model, Questions } from '@yaks/model'
import { equal } from '@yaks/testing'

const questions: Questions = {
  ready: { type: 'noul', instructions: 'Is the work ready?' },
  route: {
    type: 'choice',
    instructions: 'Pick a route',
    criteria: { fast: 'Fast', safe: 'Safe' },
  },
  quality: {
    type: 'score',
    instructions: 'Rate quality',
    criteria: ['poor', 'good'],
  },
}
const model: Model = async (request) => ({
  id: 'r1',
  model: request.model,
  items: [],
  answers: {
    ready: { noul: 0.9 },
    route: { choice: 'safe' },
    quality: { score: 1 },
  },
})
const reply = await model({ model: 'example', items: [], tools: [], questions })
equal(reply.answers, {
  ready: { noul: 0.9 },
  route: { choice: 'safe' },
  quality: { score: 1 },
})
```

## Expected failures

A **ModelError** is an expected failure carrying a `code`, such as a refusal,
rate limit or missing credential. `retry` marks a failure that may pass;
`retry.after` is the provider's wait in milliseconds. `response` (`Answered`)
retains the provider's error body and limit headers, stored in the `response`
component. Other exceptions are unexpected failures.

```ts
import { ModelError } from '@yaks/model'
import { equal } from '@yaks/testing'

const error = new ModelError('rate_limit', 'Try later', { after: 1000 }, {
  body: 'Too many requests',
  headers: { 'retry-after': '1' },
})
equal(error.code, 'rate_limit')
equal(error.retry, { after: 1000 })
equal(error.response?.headers, { 'retry-after': '1' })
```

## Generated media recovery

A **media receipt** (`MediaReceipt`) is private delivery metadata attributed to
an original model request by `call`: its provider `id`, `model`, `input` and
`response`, optional cost, and optional delivered reply. `complete: false` marks
an incomplete recording, retained privately and refused by delivery. Media
receipts can also hold text responses. `MediaReceipts` provides `read(call)` and
`save(receipt)`. Keep media receipts private; provider responses can include
temporary URL credentials.

`provider` identifies the adapter that owns delivery; legacy Workers AI receipts
have no provider field.

`receivedMedia` saves a media receipt before awaiting `Request.onReceipt`, then
calls `Request.onMedia` for a complete recording. `recoveredMedia` returns a
saved reply, or calls `deliver` and saves its reply; it never generates media. A
provider implements that delivery through `Model.recover(call)`.

`mediaReceipts` adapts a private `read`/`update` interface. It refuses a second
provider id for the same call and verifies the saved media receipt. Its `update`
callback must receive the stored mutable data and durably save it.

Its optional second argument is a private `Blobs` store from `@yaks/blob`. With
it, the full receipt is saved and verified as a content-addressed payload before
the record stores only `call`, `id`, `model` and the payload address.
`MediaRecord` describes that pointer and existing inline receipts. Reading a
pointer verifies its payload and reconstructs the receipt; a missing or corrupt
payload fails rather than requesting another generation. Existing inline
receipts remain readable and become pointers only when normally saved during
delivery. Both the record store and the payload store must remain private.

```ts
import {
  mediaReceipts,
  type MediaRecord,
  receivedMedia,
  recoveredMedia,
} from '@yaks/model'
import { equal } from '@yaks/testing'
import { memoryBlobs } from '@yaks/blob'

const records = new Map<string, MediaRecord>()
const store = mediaReceipts({
  read: async (call) => records.get(call),
  update: async (call, fn) => {
    const record = records.get(call) ?? {}
    const result = await fn(record)
    records.set(call, record)
    return result
  },
}, memoryBlobs())
let checkpoints = 0
await receivedMedia(
  {
    model: 'example',
    items: [],
    tools: [],
    onMedia: async (receipt) => {
      equal((await store.read(receipt.call))?.id, 'r1')
      checkpoints++
    },
  },
  { call: 'c1', id: 'r1', model: 'example', input: {}, response: {} },
  store,
)
let deliveries = 0
const deliver = async () => {
  deliveries++
  return { id: 'r1', model: 'example', items: [] }
}
const reply = await recoveredMedia('c1', store, deliver)
equal(await recoveredMedia('c1', store, deliver), reply)
equal([checkpoints, deliveries], [1, 1])
```

## Submission checkpoints

A **submission checkpoint** is the awaited `Request.onSubmit` callback at the
paid HTTP boundary. The host calls `submitCall(graph, call, at)` to write
server-only `submitted{at}` on the original ask, guarded against an existing
submission. A lost acknowledgement still counts as submitted. Adapters with a
submission checkpoint send at most one paid POST; retrying the original ask must
recover its receipt or report an uncertain outcome.

`Request.onAck` receives provider-owned components at the first acknowledgement,
before the adapter consumes more output. `Request.onReceipt` receives private
output before conversion, download, delivery or cost lookup, including partial
media. These callbacks finish before the adapter proceeds; a storage failure
stops it. `Request.onFirst` is told once, when the reply's first output arrives
(text, reasoning or a tool call, or the whole reply from a request that does not
stream); an adapter calls `began(req)` there, and the time to it is the
request's time to first token.

```ts
import { acknowledged, type Request, submitted } from '@yaks/model'
import { equal } from '@yaks/testing'

let order: string[] = []
const request: Request = {
  call: 'ask-1',
  model: 'example',
  items: [],
  tools: [],
  onSubmit: async () => {
    order.push('submitted')
  },
  onAck: async (mark) => {
    order.push(String(mark.example.response_id))
  },
}
await submitted(request)
await acknowledged(request, { example: { response_id: 'reply-1' } })
equal(order, ['submitted', 'reply-1'])
```

## Limits

The package stores no conversations, executes no tools and makes no provider
requests. [@yaks/session](../session/README.md) builds items from conversations;
provider adapters implement `Model`. The `tool` component belongs to
[@yaks/tools](../tools/README.md), and generated artifacts to
[@yaks/blob](../blob/README.md). Applications provide graph storage and private
media receipt storage.

## Cached-prefix expiry

A **cached-prefix expiry** is the instant a completed request's prompt cache is
expected to stop being reusable, not the lifetime of a stored response or a
credential. Providers record `cache_expires_at` on their own ask component.
`cachedPrefixExpires` reads that snapshot; absent or invalid expiry is unknown
and must not justify routing a reply to a settled session.

```ts
import { cachedPrefixExpires } from '@yaks/model'
import { equal } from '@yaks/testing'

equal(
  cachedPrefixExpires({
    openai: { cache_expires_at: '2026-10-03T10:05:00Z' },
  }),
  '2026-10-03T10:05:00.000Z',
)
equal(cachedPrefixExpires({ usage: { cached_tokens: 1000 } }), undefined)
```

The session provider resolver reads `provider.cache_retention` (seconds) at
request dispatch and snapshots dispatch plus retention when no explicit expiry
is returned. An invalid explicit expiry does not gain a fallback. Set retention
only from documentation applicable to that provider's endpoint and models; there
is no transport-wide default. A row naming no retention leaves the expiry to the
provider's own `mark`, which @yaks/session calls with the dispatch instant
(`CacheContext.requestedAt`): @yaks/anthropic knows its documented five minutes,
and a provider that knows none records the expiry unknown. Existing asks without
expiry remain cold, so no backfill is needed.

## Stalls

Every provider stream fails as `stalled` (a `ModelError` coded `stalled`) once
its connection, its first byte or any gap after goes `Request.stallTimeout`
seconds without progress, five minutes (`STALL_TIMEOUT`) where the request names
none. The session provider resolver fills `stallTimeout` from the provider row's
`stall_timeout` at dispatch, so a row may name its own; 0 waits for ever. A
provider reads its stream through `watched(fetch, ms)` or
`watchedBody(body,
ms)` (@yaks/model/stall), or keeps a `watchdog` of its own
where its retries need one (@yaks/openai's transport), and a session reports an
exhausted stall as the failure it is.

A session keeps the instructions its newest ask sent while that ask's expiry is
in the future, so a context that changed mid-conversation does not rewrite a
prefix still in the cache. Once it has expired, or where it is unknown, the
instructions are read again and the conversation is replayed on them
(@yaks/session `cachedInstructions`).

## A provider served by a machine

A provider can be another machine:
`provider{name, transport: 'machine',
machine}`, where `machine` names the
`machine{address}` ([@yaks/machine](../machine/README.md)) whose own providers
answer. One host forwards each model request and the other answers it, so the
forwarding host needs none of the serving host's credentials or command lines.

The serving host mounts `answering(serve, report)` at `PATH` (`/model/step`): a
web handler that answers one model request from `serve` and streams the reply.
`serving(graph, implementations)` is the `serve` for a host's own providers. It
finds the model by its own name (`model.name`, the same row in every graph) and
asks the one of `implementations` whose provider the graph's `serves` edges say
serves it, under the name that provider calls it. Which providers answer is
therefore the serving host's choice of `implementations`. `offers` and
`offerFor` are the lookups beneath it. [@yaks/harness](../harness/README.md)
mounts it for a `yak` config, over the providers the config names to `serve`.

The forwarding host builds a `Model` with `forwarding(lent)`, which sends each
model request through `lent.fetch` to `PATH` under `options.base`. Where that
`fetch` goes (a tunnel, a private network, the same process) is the host's
concern. `forwarded(graph, reach)` builds one for every provider row a machine
serves, keyed by `provider.name`, from the `fetch` that `reach(machine)` gives;
a row naming no machine, or one `reach` gives nothing for, is left out.

```ts
import { type Model, ModelError } from '@yaks/model'
import { answering, forwarding } from '@yaks/model/step'
import { equal } from '@yaks/testing'

const local: Model = async (request) => {
  request.onText?.({ index: 0, text: 'Hello' })
  return {
    id: 'r1',
    model: request.model,
    items: [{ kind: 'assistant', text: 'Hello' }],
    usage: { input_tokens: 4, output_tokens: 1 },
    cost: 0.01,
  }
}
const answer = answering(local, console.error)
const model = forwarding({
  fetch: (at, init) => answer(new Request(at, init)),
})
let text = ''
const reply = await model({
  model: 'example',
  items: [{ kind: 'user', text: 'Hi' }],
  tools: [],
  onText: (delta) => text += delta.text,
})
equal(text, 'Hello')
equal(reply.usage, { input_tokens: 4, output_tokens: 1 })
equal(reply.cost, undefined)
```

The reply keeps the `usage` the serving provider counted and drops its `cost`:
what a model request cost the serving host is not what it costs the forwarding
one, which weighs the usage at its own price for the model. Text reaches
`Request.onText` as it streams, and `Request.signal` stops the model request on
both hosts.

A `ModelError` the serving provider throws reaches the forwarding host with its
code, message, retry and response. Anything else is the serving host's bug: it
goes to `report` there, and the forwarding host is told only that the model
request failed (`serving`). A machine that does not answer, refuses the path or
drops the stream fails as `unreachable`, and one that goes quiet as `stalled`;
both may pass, so a caller can ask again or ask another provider. A quiet model
request sends a comment every `BEAT` milliseconds, so the forwarding host's
stall timeout measures the connection between the hosts while the serving host's
own measures its provider. A model request for image or audio output is refused
(`modalities`) before it is sent, since generated media would stay in the
serving host's store.

## Hosted inference

An **executor** (`Executor`) accepts an original ask by `submit(call, request)`
and reads its completed reply through `resume(call)`. Repeated submission keeps
that call's frozen request and execution identity. An absent reply means
pending; a terminal `ModelError` ends that ask. The session releases its runner
while pending and resumes when `inference.receipt` is written.

An executor's optional `available()` controls admission of new asks. An accepted
ask keeps its executor even while admission is unavailable. With `name` set, the
session records `inference.executor` when it creates the ask, so recovery can
distinguish it from an interrupted inline call before the request is frozen.

`inference{executor, request, receipt}` holds the pinned executor release and
private object references on the original ask. Its receipt reference is absent
until delivery can resume. Requests and receipts contain conversation data and
must stay private. `frozenRequest` removes process callbacks and serializes
image and document bytes; `thawedRequest` restores the model request.

```ts
import { frozenRequest, thawedRequest } from '@yaks/model'
import { equal } from '@yaks/testing'

const request = frozenRequest({
  model: 'example',
  tools: [],
  items: [{
    kind: 'image',
    bytes: new Uint8Array([1, 2]),
    mediaType: 'image/png',
    label: 'input',
  }],
  onText: () => {},
})
const restored = thawedRequest(JSON.parse(JSON.stringify(request)))
equal(restored.items[0], {
  kind: 'image',
  bytes: new Uint8Array([1, 2]),
  mediaType: 'image/png',
  label: 'input',
})
equal(restored.onText, undefined)
```

`infer(job, host)` saves an `InferenceReceipt` before returning its reference.
The host atomically claims submission, supplies the provider adapter and private
storage, and awaits provider acknowledgement checkpoints. A repeated step reads
its receipt or calls `Model.recover` without generation. A complete provider
receipt permits delivery retries; an unrecoverable outcome records interruption.
`inferenceReply` reads that result and refuses to regenerate it. Billing and
transcript delivery belong to the host and each keep the original ask identity.
