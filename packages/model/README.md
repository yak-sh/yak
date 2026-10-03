# @yaks/model

Defines provider-neutral model request and reply types, vocabulary for providers
and models, and helpers for billing and recovering generated media. Use it
between a conversation and a provider adapter; it implements no transport.

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

## Install

```sh
deno add jsr:@yaks/model
```

## Exports

| Export              | Provides                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/model`       | `Model`, `Request`, `Reply`, `Item`, `Tool`, `TextDelta`, `Question`, `Questions`, `Answer`, `Usage`, `Price`, `Mark`, `Answered`, `Listed`; `ModelError`; `models`, `modelDoc`, `addressed`, `requesting`, `confirmed`; `weigh`, `billed`; `MediaReceipt`, `MediaReceipts`, `mediaReceipts`, `receivedMedia`, `recoveredMedia`; component-name constants `PROVIDER`, `MODEL`, `TOOL`, `QUESTIONS`, `ANSWER`, `USAGE`, `PRICE`, `COST`, `RESPONSE` |
| `@yaks/model/vocab` | `modelDoc`, `docs`, `description`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `@yaks/model/rules` | `rules()`, returning `[models()]`                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Items and delivery

`Tool` describes a [tool](../graph/README.md#tools): its `name`, `description`
and JSON Schema `parameters`. A `call` item holds JSON arguments in `args`; a
`result` item answers that call by its `id`. The caller executes tools.

An `image` item holds `bytes`, `mediaType` and a textual `label`. The caller
resolves stored media into bytes before calling the model. A provider adapter
translates items into its protocol and determines which inputs it supports.

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

`modelDoc` declares `provider`, `model`, `serves`, `usage`, `price`, `cost`,
`response`, `questions` and `answer`. `models()` supplies a graph
[plugin](../graph/README.md#data-model) with that vocabulary, name addressing
and the `requesting` admission [hook](../graph/README.md#data-model).
`@yaks/model/rules` exports the same plugin through `rules()`.

Provider and model names are each an
[identity](../vocab/README.md#identity-and-indexes). `addressed` resolves those
names to [eids](../graph/README.md#data-model); a name held by both a provider
and a model is refused. A **serves** component records a provider's offering of
a model on an [edge](../edge/README.md); `serves.name` is the name that provider
accepts, which may differ from `model.name`.

`requesting` replaces a name in `using.model` with its eid and creates an
unknown model with `offered: false` and `pending: {}`.
`confirmed(provider,
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

**Usage** (`Usage`, `usage`) is token counts for one model request. Cached input
and reasoning output are subsets of input and output, not extra tokens; an
absent count is unknown. **Price** (`Price`, `price`) is dollars per million
input, output and optional cached input tokens. **Cost** (`cost`) is the dollars
spent by one model request or tool call, with `reported` saying whether the
provider supplied that amount.

`weigh(price, usage)` calculates dollars, treating missing counts as zero and
using the input price when the cached price is absent. `billed(reply, price?)`
uses `Reply.cost` first (provider-reported unless `costReported: false`), then
weighs usage if both usage and price exist, or returns `undefined`.

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
`response`, optional cost, and optional delivered reply. `MediaReceipts`
provides `read(call)` and `save(receipt)`. Keep media receipts private; provider
responses can include temporary URL credentials.

`receivedMedia` saves a media receipt before calling `Request.onMedia`.
`recoveredMedia` returns a saved reply, or calls `deliver` and saves its reply;
it never generates media. A provider implements that delivery through
`Model.recover(call)`.

`mediaReceipts` adapts a private `read`/`update` interface. It refuses a second
provider id for the same call and verifies the saved media receipt. Its `update`
callback must receive the stored mutable data and durably save it.

```ts
import {
  type MediaReceipt,
  mediaReceipts,
  receivedMedia,
  recoveredMedia,
} from '@yaks/model'
import { equal } from '@yaks/testing'

const records = new Map<string, Partial<MediaReceipt>>()
const store = mediaReceipts({
  read: async (call) => records.get(call),
  update: async (call, fn) => {
    const record = records.get(call) ?? {}
    const result = await fn(record)
    records.set(call, record)
    return result
  },
})
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

## Limits

The package stores no conversations, executes no tools and makes no provider
requests. [@yaks/session](../session/README.md) builds items from conversations;
provider adapters implement `Model`. The `tool` component belongs to
[@yaks/tools](../tools/README.md), and generated artifacts to
[@yaks/blob](../blob/README.md). Applications provide graph storage and private
media receipt storage.
