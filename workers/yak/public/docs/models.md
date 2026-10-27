---
doc:
  title: AI Models
guide:
  slug: models
  brief: calling AI models from an app, with the answers written as rows
  description: >-
    Calling AI models (LLMs) from an app with no API key: a page writes a
    transcript entry naming a model, the app's store calls the model, and the
    reply is written as rows in the same transcript for any subscribed page to
    receive. Instructions, typed questions answered as rows (a choice, a
    yes-or-no, a score), audio from a connected model, builders over stored
    rows, a single synchronous call through ./api/ai/run or a worker's AI
    binding, image input, the commands a model may call, who may call a model,
    and model prices and how platform and connected models are paid for.
---

# AI Models

The guide's map is at <https://yaks.app/docs.md>. This page covers how an app
calls an AI model: the rows that ask, the rows written back, and what calls
cost.

An app needs no API key in its code and no server of its own to use a model. It
writes a row that asks; the app's store calls the model and writes the answer
back as rows. A connected model uses the app's integration, and its key stays in
the space's vault. A page subscribed to the transcript receives the answer when
it is written.

## Transcripts, entries and turns

A transcript is any entity with a `session` component. Each line of it is an
`entry`. An entry that names a model with `using` asks for a turn, and `sending`
on the same entry sets what the model is sent:

    import { apply, subscribe } from './api/client.js'

    let smith = crypto.randomUUID()
    await apply([
      { entity: { eid: smith }, doc: { title: 'The smith' }, session: {} },
      {
        entity: { eid: '$said' },
        entry: { session: smith },
        content: { body: 'A stranger walks up to the forge.' },
        using: { provider: 'workers-ai', model: '@cf/zai-org/glm-5.3-flash' },
        sending: {
          instructions: 'You are the village smith: gruff, kind, brief.',
        },
      },
    ])

`using` selects the model and holds only `provider`, `model` and `effort`.
`using.model` is any model name its selected provider serves. Name the provider
explicitly: `workers-ai` for platform models, `openrouter` for the app's
connected OpenRouter account, or `openai` for OpenAI. Without `using.provider`,
the store uses the model's sole known provider; an untried `@cf/` model or
`typesafe/jev` resolves to `workers-ai`. An unknown or ambiguous selection
receives a `refusal` entry and the transcript becomes `failed`.

`sending` holds what the model is sent, and `sending.instructions` is what a
conversational model is told before the transcript. The store refuses
`instructions` or `window` written inside `using`, as it refuses any property
the vocabulary does not declare.

`using` and `sending` stay in force for the rest of the transcript: each turn
uses the newest `using` and the newest `sending` that any entry carries. After
the first entry with `using`, every new entry with `content` asks for another
turn with the model and instructions in force, so a later entry carries `using`
or `sending` only to change them.

Two more properties limit what a turn costs. `sending.window` is how many of the
transcript's newest lines the model reads, extended back to the line that began
the turn the window would otherwise cut into; without it every turn reads the
whole transcript, so each new line makes a long conversation more expensive.
`using.effort` sets how much reasoning the model does before it answers: GLM
Flash accepts `low`, `high` or `max` (its default), and every reasoning token is
billed as output.

    using: {
      provider: 'workers-ai',
      model: '@cf/zai-org/glm-5.3-flash',
      effort: 'low',
    },
    sending: {
      instructions: 'You are the village smith: gruff, kind, brief.',
      window: 16,
    },

The store writes its response as more entries in the same transcript:

- an `ask` — the moment the model was asked, with what the call used (`usage`)
- the reply — `content { body }` with `output { source }` naming the ask

A page receives the reply through a subscription, like any other change:

    subscribe(`.entry.session=${smith}&?content&?refusal`, (rows) => {
      for (let row of rows) {
        if (row.content) console.log(row.content.body)
      }
    })

No polling is needed: the write that asks returns at once, and the reply arrives
through the subscription shortly after. Each turn sends the model the
transcript's lines: the entries written to it, the model's replies, and any
command calls and their results, but not the `ask` entries, errors, or typed
questions and answers. It sends all of them, or only the newest lines
`sending.window` counts. `session.status` gives the transcript's state:
`pending` while a turn is owed, `settled` once the model has answered, `failed`
when it could not be asked.

## Typed questions and structured answers

Free text is for people to read. For a decision a page acts on, ask Jev
(`typesafe/jev`) a question with a typed answer by putting `questions` beside
the entry:

    await apply({
      entity: { eid: '$next' },
      entry: { session: smith },
      content: { body: 'Evening falls. The stranger has gone.' },
      using: { provider: 'workers-ai', model: 'typesafe/jev' },
      questions: {
        asked: {
          plan: {
            type: 'choice',
            instructions: 'Where does the smith go next?',
            criteria: { forge: 'back to work', well: 'to rest by the well' },
          },
        },
      },
    })

Each question's answer comes back as an entry of its own with an `answer`
component, named by the question:

    answer { question: 'plan', choice: 'forge', confidence: 0.82,
             probabilities: { forge: 0.82, well: 0.18 } }

A `choice` picks one of its criteria's names. A `noul` answers a yes-or-no as
the probability that it holds (`answer.noul`). A `score` places the answer along
ordered criteria (`answer.score`). The page reads the newest one with
`.entry.session=<smith>&.answer.question=plan&.order=-entry.seq&.limit=1`.

A model that does not answer typed questions refuses them rather than guessing;
only Jev answers them. The answers are for the page only: no later turn reads
them, or the questions another turn asked, so a transcript that a page asks
questions about every few minutes keeps its window for the conversation itself.

## Audio generation with a connected model

An app can ask `bytedance-seed/seed-audio-1-0` for an audio clip. Its owner
first calls `store_connection_need` for the app with `integration: 'openrouter'`
and signs in on the space's connections page. The app never receives the
OpenRouter key. The entry's text is the sound prompt; this model does not use
`sending.instructions` or typed questions.

    await apply({
      entity: { eid: '$sound' },
      entry: { session: smith },
      content: { body: 'A forge hammer ringing on an anvil' },
      using: {
        provider: 'openrouter',
        model: 'bytedance-seed/seed-audio-1-0',
      },
    })

The reply is an `entry` with `attachment.artifact` pointing to an `artifact`
row. That row carries the media type and size. A page can play the bytes at
`./api/blob/<artifact-id>`; the platform keeps them in the app's blob store. If
the app has no OpenRouter connection, the transcript receives a refusal with
`code: 'connection'`.

## Builders: model output for each stored row

A `builder` selects rows from this app's store with a query. Its `content.body`
is the `$var` template; `doc.body` documents the builder. `builder.to` names a
registered tool. The built-in model tool opens a session in the same store, and
its answer becomes `built` rows:

    import { modelToolEid } from '@yaks/builders/model'

    await apply({
      entity: { eid: '$summaries' },
      doc: { title: 'Summaries' },
      content: { body: 'Summarize $body.' },
      using: { model: '<model-eid>' },
      builder: {
        query: '$note .note, doc.body=$body',
        to: modelToolEid(),
      },
    })

Each outer query match gets a durable `build` and a fresh tool `call` when its
key changes. The model returns named slots with components and the selected
input ids each used. Each call keeps its own take in a slot; its citations are
`cites` edges. Query `.build.builder=<builder-id>&*`, then
`.built.build=<build-id>&*` to find the outputs; what was built for one row now
is `.built.build.build.for=<row-id>&.built.current=true&*`. When a row stops
matching, its build becomes stale, and the build and its outputs are kept as
history. Changing `builder.floor` to a time in the past checks every match
again. A `wake` can check it later, and `builder.immediate: true` also checks
changed inputs. Only app editors may write a builder, since model turns spend
the owner's account budget.

A builder written with `staged: {}` builds nothing by itself, so a new prompt
can be tried on a few rows first. `store_builder_build` builds it now: `only`
names the rows to build for, `limit` takes the first few, and a `template`,
`provider` or `model` tried in place of its own builds a shadow variant that
nothing else selects. Remove the mark (`staged: null`) to build the rest; a row
already built with the same prompt is not asked again.

## Synchronous calls with `./api/ai/run`

A page that needs the answer in the response to its own request, rather than in
a transcript, POSTs the model's name and its input to `./api/ai/run`:

    let res = await fetch('./api/ai/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: '@cf/baai/bge-base-en-v1.5',
        input: { text: ['a stranger at the forge'] },
      }),
    })
    let { data } = await res.json()

`input` is what Workers AI takes for that model (its page at
<https://developers.cloudflare.com/workers-ai/models/>), and the response is the
model's output. Nothing is stored; use a transcript to keep what was said. An
app's worker calls a model the same way through a binding:
`"ai": { "binding": "AI" }` in its `wrangler.jsonc` gives it
`env.AI.run(model, input)` (see [Backend Code](/docs/code)), which calls the
model as the app itself.

To keep calls from the same conversation on the same cache-capable model worker,
add a stable `session_id` beside `model` and `input`, or send the
`x-session-affinity` header (the header takes precedence). An app's worker can
use `env.AI.run(model, input, {extraHeaders: {'x-session-affinity': session}})`.
Existing calls with only `model` and `input` keep working. Affinity is a routing
hint: it does not guarantee a cache hit, and not every model supports it.
Transcripts send their session id automatically; keep instructions and tools
stable where their meaning has not changed.

The same people who may ask for a turn (see Who may call a model, below) may
call it, and it spends the same account budget. A refusal uses the error format
every endpoint uses, `{error: {code, message}}`: `400` for a model not offered
here or an input the model refuses, `429` past the budget, with a message that
says so, and `503` while the model is busy. Show the person `error.message`.

## Image input (vision models)

A vision model takes the image inside the request, in the same single call:
`@cf/meta/llama-4-scout-17b-16e-instruct` reads a message whose `content` is a
list of parts, the text as a `text` part and the image as an `image_url` part
holding a `data:` URL. A transcript's entries hold text only, so an image is
sent this way.

Downscale the photo first, as for an upload (`smaller()` on
[Files and Uploads](/docs/files)); 1024 pixels on its long side is enough for
the model. Then send the same bytes to both endpoints in parallel: `upload`
stores the image in the app, and the call asks the model about it.

    import { apply, upload } from './api/client.js'

    let dataUrl = (blob) => new Promise((ok, no) => {
      let r = new FileReader()
      r.onload = () => ok(r.result)
      r.onerror = () => no(r.error)
      r.readAsDataURL(blob)
    })

    let file = input.files[0]
    let photo = await smaller(file, 1024)
    let question = 'What is in this photo?'
    let [kept, res] = await Promise.all([
      upload(photo, { name: file.name }),
      fetch('./api/ai/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: '@cf/meta/llama-4-scout-17b-16e-instruct',
          input: {
            messages: [{ role: 'user', content: [
              { type: 'text', text: question },
              { type: 'image_url', image_url: { url: await dataUrl(photo) } },
            ] }],
            max_tokens: 400,
          },
        }),
      }),
    ])
    let said = await res.json()
    if (!res.ok) throw new Error(said.error.message)
    await apply({ asked: { photo: kept.eid, question, answer: said.response } })

The model's text answer is in `response`. The call stores nothing, so the last
line stores the question and the answer with the image's eid, in `asked`, a
component the app declares in its `vocab.json` the way `photo` is declared on
the Files and Uploads page.

Send the image only as an `image_url` part. An `image` beside a `prompt` (the
shape Llama 3.2 Vision takes) is ignored by this model, which then answers as if
there were no image. Llama 3.2 Vision itself is not offered here: its license
has not been accepted for the platform.

## Commands a model may call

A model may call the app's own commands (see [App Commands](/docs/tools)), but
only the ones the app marks for it with `"model": true`. Those are the tools it
is offered, and no others. A call runs as the person who asked for the turn,
limited to exactly what they could write on the page themselves, and `$session`
in its template is the transcript the turn is in, which no argument can change.
What it writes is stamped `created.via` with that transcript, which a page's own
write never is, so an app can check `created.via` on a row it should trust only
when its model wrote it.

## Who may call a model

A model's turn costs money, so by default only the space's members who may
change the app can ask for one: an entry with `using` from anybody else is
refused like any other write they may not make, and so is their call to
`./api/ai/run`. An app that wants its visitors to ask too says so at the top of
its `vocab.json`:

    { "models": "open", "$defs": { … } }

Then anyone who may write the app may ask, which on an `open` app is anyone with
the link, and every turn they ask for spends the owner's budget.

Since every line after a `using` asks for a turn, a visitor to an `open` app
writes entries only in transcripts they started; a line in a member's transcript
is refused, whatever `models` says.

## Models and pricing

These platform models spend the owner's monthly yaks.app account budget:

| model                                     | for             | per million tokens in | out   |
| ----------------------------------------- | --------------- | --------------------- | ----- |
| `@cf/zai-org/glm-5.3-flash`               | chat, and tools | $0.15                 | $0.50 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | pictures        | $0.27                 | $0.85 |
| `typesafe/jev`                            | typed questions | $0.042                | free  |
| `@cf/baai/bge-base-en-v1.5`               | embeddings      | $0.067                | —     |

Every platform call is charged at its model's price against that budget, which
is $0.20 plus $3.00 for each space the owner has on the Plus plan, shared by all
of the owner's spaces. The builder and app voice calls spend it too. `app_list`
shows what each space spent.

`bytedance-seed/seed-audio-1-0` uses the app's connected OpenRouter account.
OpenRouter bills that account for generated audio at its published rate; it does
not spend the yaks.app account budget.

A call that starts under the budget finishes even if it goes over. The next one
is refused: the transcript gets a `refusal { code: 'limit' }` entry whose
`content.body` says which limit it reached, and the transcript stays `failed`
until a new entry asks again, on the 1st of the month or once the account's
budget is raised. A `refusal` row is the platform's, so a listing leaves it out
unless the filter names `refusal` or asks for transcript `entry` rows. Subscribe
with `&?refusal` to show the message.

A model's rate limit is shared by every app on the platform. A turn that hits it
is retried; after three failures in a row the transcript stays `failed` until a
new entry asks.

Builder definition edits do not regenerate existing outputs.
`store_builder_build` without redo flags builds only new bindings or changed
inputs. `outdated: true` redoes selected bindings made under an older
definition; `rebuild: true` redoes every selected binding, including unchanged
ones. Both accept `only` and `limit`. Try an alternate template or model as a
shadow first. `.build.outdated=true` finds older definitions;
`.built.current=true` keeps selecting the chosen take until its binding
disappears or another take is chosen. A successful redo adds takes, newest
chosen by default; `store_builder_choose` chooses a retained earlier output
without spending. List all takes with `.built.build=<build>&*`; `.chosen` shows
the one in use.
