# @yaks/model

**The seam between a conversation and the model that serves it** — for a
[@yaks/graph](https://jsr.io/@yaks/graph).

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
  model that served, and the items it produced.
- **`provider`, `model`, `tool`** — the entities a graph keeps about serving, as
  one vocabulary document (`modelDoc`), so which models exist is data.

A provider package implements `Model`: [@yaks/openai](../openai) does it over
the Responses API; an Ollama or a Workers AI sibling would sit beside it. A
conversation package ([@yaks/session](../session)) shapes its record into items
and asks. Neither imports the other.

A model that throws `ModelError` said something the caller expects — a refusal,
a rate limit, no credential. Anything else it throws is a defect.
