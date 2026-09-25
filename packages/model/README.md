# @yaks/model

Provider-neutral request and reply types for model calls, plus vocabulary for
providers and models. This package defines the interface; it does not make
network requests.

## Install

```sh
deno add jsr:@yaks/model
```

## What it is

Three things, and no transport:

- **`Item`** — one conversation item sent to or returned by a model: a user
  turn, an assistant turn, a call the model asked for, the result it was given.
- **`Model`** — `(Request) => Promise<Reply>`. A request is a model name, the
  items, the tools, and an optional provider response reference (an **anchor**)
  to continue from; a reply is an id, the model that served it, and the items it
  produced. A provider that stores its replies adds three optional members:
  `mark` (the component to write on the record of a reply), `anchor` (reads an
  anchor back off that record, or returns nothing) and `vocab` (the component
  `mark` writes).
- **`provider`, `model`, `serves`** — graph components describing providers,
  models, and which provider serves which model, exported as the JSON Schema
  document `modelDoc`. A provider and a model are each identified by `name` (the
  vocabulary's `identity` keyword), so the same name is the same entity in every
  graph, and the name is accepted wherever its eid is: `using.model` may say
  `gpt-6-astra`. A model is the model itself, whoever serves it. A provider's
  offering of a model is an edge, provider `serves` model, carrying
  `serves.name`: what that provider calls the model, sent as the model of every
  request it serves. The `tool` component belongs to [@yaks/tools](../tools),
  not this vocabulary. `Tool` here is the provider-neutral TypeScript type for a
  callable tool description.

A provider package implements `Model`: [@yaks/openai](../openai) does it over
the Responses API; an Ollama or a Workers AI package would sit beside it. A
conversation package ([@yaks/session](../session)) turns its stored transcript
into items and calls the model. Neither imports the other.

The root module exports these types, `ModelError`, `modelDoc`, the `models()`
graph plugin, and the `PROVIDER`, `MODEL`, and `TOOL` component-name constants.
`@yaks/model/vocab` exports `modelDoc` and `docs: [modelDoc]` for plugin
loaders. `@yaks/model/rules` exports `rules()`, which supplies that plugin: the
schema and the name lookup, and no other write-time behavior. The package has no
database or conversation storage; the calling application stores the provider
and model records if it needs them.

A model that throws `ModelError` failed in a way the caller expects — a refusal,
a rate limit, a missing credential. Other exceptions are unexpected failures
that the caller can record separately.

## Minimal implementation

```ts
import type { Model } from '@yaks/model'

const model: Model = async (request) => ({
  id: 'reply-1',
  model: request.model,
  items: [{ kind: 'assistant', text: 'Example response' }],
})

const reply = await model({
  model: 'example',
  items: [{ kind: 'user', text: 'Hello' }],
  tools: [],
})
```

The caller supplies tool descriptions and executes returned calls. This
interface neither executes tools nor stores conversation history. Optional
provider anchors only work when the provider retains the corresponding response;
without an anchor, the caller supplies the required conversation items again.

### Image inputs

An explicit image input is an `Item` with `kind: 'image'`, `bytes: Uint8Array`,
`mediaType`, and a textual `label`. Providers translate it into their multimodal
request format. Applications resolve artifact references before calling the
model; raw bytes need not be persisted in conversation text. Applications should
bound total image bytes and ensure the selected provider supports vision.

A request may carry `signal: AbortSignal`. Model adapters should propagate it to
provider I/O. Cancellation applies to that request, not independently launched
tool processes. Adapters that cannot cancel should document that limitation.
