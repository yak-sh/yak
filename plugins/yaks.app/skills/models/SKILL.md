---
name: models
description: "Asking a model (yaks.app). A transcript in the app's own store: a page writes an entry naming a model, the store asks it, and the answer lands beside the ask for any page subscribed to see. Instructions, typed questions answered as rows (a choice, a yes-or-no, a score), one call answered at once through ./api/ai/run or a worker's ai binding, the commands a model may call, who may ask, and how platform and connected models are paid for."
---

# Asking a model

The map is at <https://yaks.app/docs.md>. This page is the whole of an app
asking a model: the rows that ask, the rows that come back, and what it costs.

An app needs no key in its code and no server of its own to use a model. It
writes a row that asks, its own store asks the model, and the answer is written
back as rows. A connected model uses the app's integration; the key stays in the
space's vault. A page subscribed to the transcript sees the answer land.

## A transcript is rows

A transcript is any entity wearing `session`. Each line of it is an `entry`, and
an entry that names a model with `using` asks for a turn:

    let smith = '$smith'
    await apply([
      { entity: { eid: smith }, doc: { title: 'The smith' }, session: {} },
      {
        entity: { eid: '$said' },
        entry: { session: smith },
        content: { body: 'A stranger walks up to the forge.' },
        using: {
          model: '@cf/zai-org/glm-5.3-flash',
          instructions: 'You are the village smith: gruff, kind, brief.',
        },
      },
    ])

`using.model` is the model's name (the list below), and `using.instructions` is
what a conversational model is told before the transcript. Every entry that asks
for a turn carries its own `using`, so each turn names its model and its
instructions; an entry without one is part of the transcript the next turn
reads, and asks for nothing.

Two more keep a turn cheap. `using.window` is how many of the transcript's
newest lines the model reads, reaching back to the line that began the turn it
cuts into; without it every turn reads the whole transcript, so a conversation
that goes on for weeks costs more with every line. `using.effort` is how hard
the model thinks before it answers: GLM Flash takes `low`, `high` or `max` (its
default), and every word of that thinking is billed as output.

    using: {
      model: '@cf/zai-org/glm-5.3-flash',
      instructions: 'You are the village smith: gruff, kind, brief.',
      window: 16,
      effort: 'low',
    }

The store answers with more entries in the same transcript:

- an `ask` — the moment the model was asked, with what the call used (`usage`)
- the reply — `content { body }` with `output { source }` naming the ask

Watch for the reply the way a page watches anything:

    subscribe(`.entry.session=${smith}&?content`, (rows) => draw(rows))

Nothing polls, and the write that asked is answered at once: the reply arrives
through the subscription a moment later. Every new entry with `using` is another
turn, and the model sees the whole transcript each time. `session.status` says
where it stands: `pending` while a turn is owed, `settled` once the model has
answered, `failed` when it could not be asked.

## A question with a typed answer

Prose is for people. A decision a page acts on is a question with a typed
answer, asked of Jev (`typesafe/jev`) by putting `questions` beside the entry:

    await apply({
      entity: { eid: '$next' },
      entry: { session: smith },
      content: { body: 'Evening falls. The stranger has gone.' },
      using: { model: 'typesafe/jev' },
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

Each question comes back as an entry of its own wearing `answer`, named by the
question:

    answer { question: 'plan', choice: 'forge', confidence: 0.82,
             probabilities: { forge: 0.82, well: 0.18 } }

A `choice` picks one of its criteria's names. A `noul` answers a yes-or-no as
the probability that it holds (`answer.noul`). A `score` places the answer along
ordered criteria (`answer.score`). The page reads the newest one with
`.entry.session=<smith>&.answer.question=plan&.order=-entry.seq&.limit=1`.

A model that answers no typed questions refuses them rather than guessing:
questions are Jev's. The answers are for the page: no later turn reads them, or
the questions another turn asked, so a transcript a page asks about every few
minutes keeps its window for what was said.

## Generate audio with a connected model

An app can ask `bytedance-seed/seed-audio-1-0` for an audio clip. Its owner
first calls `connection_need` for the app with `integration: 'openrouter'` and
signs in on the space's connections page. The app never receives the OpenRouter
key. The entry's text is the sound prompt; this model does not use
`using.instructions` or typed questions.

    await apply({
      entity: { eid: '$sound' },
      entry: { session: smith },
      content: { body: 'A forge hammer ringing on an anvil' },
      using: { model: 'bytedance-seed/seed-audio-1-0' },
    })

The reply is an `entry` with `attachment.artifact` pointing to an `artifact`
row. That row carries the media type and size. A page can play the bytes at
`./api/blob/<artifact-id>`; the platform keeps them in the app's blob store. If
the app has no OpenRouter connection, the transcript receives an error with
`code: 'connection'`.

## Build from stored rows

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
input ids each used. A slot keeps its id across rebuilds; its citations are
`cites` edges. Query `.build.builder=<builder-id>&*`, then
`.built.build=<build-id>&*` to find the outputs; what was built for one row now
is `.built.build.for=<row-id>&.built.current=true&*`. A vanished match leaves a
stale build and its outputs as history. Changing `builder.floor` to a time in
the past checks it again. A `wake` can check it later, and
`builder.immediate: true` also checks changed inputs. Only app editors may write
a builder, since model turns spend the owner's account budget.

A builder written with `staged: {}` builds nothing by itself, so a new prompt
can be tried on a few rows first. `builder_build` builds it now: `only` names
the rows to build for, `limit` takes the first few, and a `template` or `model`
tried in place of its own builds a shadow variant that nothing else selects.
Remove the mark (`staged: null`) to build the rest; a row already built with the
same prompt is not asked again.

## One call, answered at once

A page that wants the answer in the same request, rather than in a transcript,
posts `./api/ai/run` the model's name and its input:

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
<https://developers.cloudflare.com/workers-ai/models/>), and the answer is what
the model says back. Nothing is kept: a transcript is the way to keep what was
said. An app's worker asks the same way through a binding:
`"ai": { "binding":
"AI" }` in its `wrangler.jsonc` gives it
`env.AI.run(model, input)` (see [Code](/docs/code)), which asks as the app
itself.

The same people may call it as may ask for a turn (below), and the same account
budget pays. A refusal comes in the envelope every door answers with: `429` past
the budget, with the sentence that says so, and `503` while the model is busy.

## Commands a model may call

A model may call the app's own commands (see [Commands](/docs/tools)), but only
the ones the app marks for it with `"model": true`. Those are the tools it is
offered, and no others. A call runs as the person who asked for the turn, held
to exactly what they could write on the page themselves, and `$session` in its
template is the transcript the turn is in, which no argument can change. What it
writes is stamped `created.via` with that transcript, which a page's own write
never is: a row the app should trust only from its model says so.

## Who may ask

A model's turn costs money, so by default only the space's members who may
change the app ask for one: an entry with `using` from anybody else is refused
like any other write they may not make, and so is their call to `./api/ai/run`.
An app that wants its visitors to ask too says so at the top of its
`vocab.json`:

    { "models": "open", "$defs": { … } }

Then anyone who may write the app may ask, which on an `open` app is anyone with
the link — held to the pace every visitor's writes keep, 30 changes a minute.

## The models, and what they cost

These platform models spend the owner's monthly yaks.app account budget:

| model                       | for             | per million tokens in | out   |
| --------------------------- | --------------- | --------------------- | ----- |
| `@cf/zai-org/glm-5.3-flash` | chat, and tools | $0.15                 | $0.50 |
| `typesafe/jev`              | typed questions | $0.042                | free  |
| `@cf/baai/bge-base-en-v1.5` | embeddings      | $0.067                | —     |

Every platform call is weighed by its model's price and spends that budget:
$0.20, plus $3.00 for each Plus space they own. All their spaces share it. The
builder and app voice spend it too. `app_list` says what each space spent.

`bytedance-seed/seed-audio-1-0` uses the app's connected OpenRouter account.
OpenRouter bills that account for generated audio at its published rate; it does
not spend the yaks.app account budget.

A call that starts under the budget finishes even if it crosses it. The next one
is refused: the transcript gets an `error { code: 'limit' }` entry whose
`content.body` says which ceiling it met, and it rests there (`failed`) until a
new entry asks again — on the 1st, or once the account's budget grows. An
`error` row is the platform's, so a listing leaves it out unless the filter
names it: subscribe with `&?error` to show the sentence.

A model's own rate is shared by every app on the platform. A turn that meets it
is asked again; after three failures in a row the transcript rests as `failed`
until a new entry asks.
