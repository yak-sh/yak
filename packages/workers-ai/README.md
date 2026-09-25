# @yaks/workers-ai

Cloudflare Workers AI as an `@yaks/model` model, through the `AI` binding a
Worker is given. The binding is the authorization: there is no API key, no
endpoint and nothing to sign in to. Outside a Worker there is no binding, and so
no model.

```ts
import { type Binding, workersAi } from '@yaks/workers-ai'

// `ai` is a Worker's `env.AI`: the binding its Wrangler configuration names.
const hello = async (ai: Binding) => {
  const reply = await workersAi(ai)({
    model: '@cf/zai-org/glm-5.3-flash',
    items: [{ kind: 'user', text: 'Hello' }],
    tools: [],
  })
  return reply.items
}
```

Model identifiers are Workers AI's own `@cf/…` names. Tool use depends on the
model you choose.

## What is sent and read

A request becomes one `run(model, {messages, tools, max_tokens})` call.
Instructions and `instruction` items are `system` messages, a call joins the
assistant message it follows as a `tool_calls` entry, and a result is a `tool`
message naming the call it answers. `Request.tokens` is sent as `max_tokens`;
without it the model's own default applies. `effort` is not sent.

Models in the catalog answer one of two shapes, and both are read: the binding's
own (`response`, and a flat `tool_calls` of `{name, arguments}`) or OpenAI's
chat completion (`choices[0].message`). A call that arrives without an id is
given one derived from the reply's, so a result can always name its call.
`usage.prompt_tokens`, `completion_tokens`, `total_tokens` and `cached_tokens`
become the reply's usage; a count the model leaves out stays unknown.

The whole reply arrives at once, so `onText` is called once with all of its
text. `signal` is checked before the call and after it; the binding call itself
cannot be interrupted.

## Context and failures

Workers AI keeps nothing between requests. Every request carries the whole
conversation, and the model has no `anchor`, `mark` or `vocab`.

A rate limit or a model at capacity throws `ModelError` with code `busy` and the
binding's own message. An image item throws `ModelError` with code `image`,
since images are not sent. Anything else the binding throws is passed on as it
was thrown.

Tests use a stand-in binding, not paid inference.
