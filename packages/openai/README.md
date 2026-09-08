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
anything else, and without it a reply's id cannot anchor the next request, so a
caller there replays the conversation.

A refusal the API named, a missing credential, and a transport that never
connected are `ModelError`s. Anything else thrown is a defect.
