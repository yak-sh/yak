# @yaks/model

Provider-neutral request and reply types for model calls, plus vocabulary for
providers, models, and tools. This package defines the interface; it does not
make network requests.

## Install

```sh
deno add jsr:@yaks/model
```

## What it is

Three things, and no transport:

- **`Item`** — one line of a conversation as a model sees it: a user turn, an
  assistant turn, a call the model asked for, the result it was given.
- **`Model`** — `(Request) => Promise<Reply>`. A request is a model name, the
  items, the tools, an optional anchor to continue from; a reply is an id, the
  model that served, and the items it produced. A provider that keeps replies
  adds `mark` (what to stamp on the record of a reply, as its own comp),
  `anchor` (reads an anchor back off that record, or nothing) and `vocab` (the
  comp `mark` writes).
- **`provider`, `model`, `tool`** — the entities a graph keeps about serving, as
  one vocabulary document (`modelDoc`), so which models exist is data.

A provider package implements `Model`: [@yaks/openai](../openai) does it over
the Responses API; an Ollama or a Workers AI sibling would sit beside it. A
conversation package ([@yaks/session](../session)) shapes its record into items
and asks. Neither imports the other.

A model that throws `ModelError` said something the caller expects — a refusal,
a rate limit, no credential. Anything else it throws is a defect.

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
