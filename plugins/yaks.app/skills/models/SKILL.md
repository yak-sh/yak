---
name: models
description: "Asking a model (yaks.app). A transcript in the app's own store: a page writes an entry naming a model, the store asks it, and the answer lands beside the ask for any page subscribed to see. Instructions, typed questions answered as rows (a choice, a yes-or-no, a score), one call answered at once through ./api/ai/run or a worker's ai binding, the commands a model may call, who may ask, the models there are and what each costs against the space's monthly model allowance."
---

# Asking a model

The map is at <https://yaks.app/docs.md>. This page is the whole of an app
asking a model: the rows that ask, the rows that come back, and what it costs.

An app needs no key and no server of its own to use a model. It writes a row
that asks, its own store asks the model, and the answer is written back as rows.
A page subscribed to the transcript sees the answer land.

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

`using.model` is the model's name (the table below), and `using.instructions` is
what the model is told before the transcript. Every entry that asks for a turn
carries its own `using`, so each turn names its model and its instructions; an
entry without one is part of the transcript the next turn reads, and asks for
nothing.

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
questions are Jev's.

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

The same people may call it as may ask for a turn (below), and the same
allowance pays. A refusal comes in the envelope every door answers with: `429`
past the allowance, with the sentence that says so, and `503` while the model is
busy.

## Commands a model may call

A model may call the app's own commands (see [Commands](/docs/tools)), but only
the ones the app marks for it with `"model": true`. Those are the tools it is
offered, and no others. A call runs as the person who asked for the turn, held
to exactly what they could write on the page themselves.

## Who may ask

A model's turn costs the space money, so by default only the space's members who
may change the app ask for one: an entry with `using` from anybody else is
refused like any other write they may not make, and so is their call to
`./api/ai/run`. An app that wants its visitors to ask too says so at the top of
its `vocab.json`:

    { "models": "open", "$defs": { … } }

Then anyone who may write the app may ask, which on an `open` app is anyone with
the link — held to the pace every visitor's writes keep, 30 changes a minute.

## The models, and what they cost

| model                       | for             | per million tokens in | out   |
| --------------------------- | --------------- | --------------------- | ----- |
| `@cf/zai-org/glm-5.3-flash` | chat, and tools | $0.15                 | $0.50 |
| `typesafe/jev`              | typed questions | $0.042                | free  |
| `@cf/baai/bge-base-en-v1.5` | embeddings      | $0.067                | —     |

Every call is weighed by its model's price and spends the space's one model
allowance: $0.20 a month on a free space, shared by the free spaces its owner
has, and $3.00 on the Plus plan. The builder spends the same allowance, and
`app_list` says how much of it the month has spent.

A call that starts under the allowance finishes even if it crosses it. The next
one is refused: the transcript gets an `error { code: 'limit' }` entry whose
`content.body` says which ceiling it met, and it rests there (`failed`) until a
new entry asks again — on the 1st, or once the space moves to the Plus plan. An
`error` row is the platform's, so a listing leaves it out unless the filter
names it: subscribe with `&?error` to show the sentence.

A model's own rate is shared by every app on the platform. A turn that meets it
is asked again; after three failures in a row the transcript rests as `failed`
until a new entry asks.
