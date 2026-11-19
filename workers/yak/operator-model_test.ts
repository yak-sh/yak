// The model an Operator answers with is a row in the directory
// (@yaks/platform/operator-model): switching it is one write, the next turn is
// answered by it and charged at its row's price, a space's own persona may
// name another, and a summary is asked of the same model.
import { identityEid, mint } from '@yaks/graph'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Model } from '@yaks/model'
import { transcript } from '@yaks/session'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorOn } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { personaFor } from './operator-persona.ts'

let { env } = platform('operator-model', {
  ANTHROPIC_API_KEY: 'probe',
  OPENAI_OPERATOR_API_KEY: 'probe',
})
let dir = directoryOf(env.STORE)
let owner = mint()
let space = (await dir.at(
  await dir.mint(owner, 'models', 'Models', {
    'x-yak-person': owner,
    'x-yak-role': 'owner',
  }),
))!

// Each provider answers as itself, reporting `read` input tokens (a
// thousand, so a step costs a thousandth of its model's input price) and no
// dollars; a summary says so.
let asked: string[] = []
let read = 1000
let answering = (provider: string): Model =>
  Object.assign(
    (req: Parameters<Model>[0]) => {
      let summary = JSON.stringify(req.instructions ?? '').includes(
        'Summarize this transcript',
      )
      asked.push(`${provider} ${req.model}${summary ? ' summary' : ''}`)
      return Promise.resolve({
        id: mint(),
        model: req.model,
        items: [{ kind: 'assistant' as const, text: 'Hello.' }],
        usage: { input_tokens: read, output_tokens: 0 },
      })
    },
    { info: (name: string) => Promise.resolve({ name }) },
  )
let store = operatorMemory()
let operator = operating(store, env, {
  providers: { openai: answering('openai'), anthropic: answering('anthropic') },
})

// One turn: what answered it, and what its entries cost the space, in
// thousandths of a dollar.
let turn = async (say = 'Hello') => {
  asked.length = 0
  let out = await operator.ask({ person: owner }, space, { say })
  await drain(store)
  let entries = await transcript(store.g, out.session)
  let mine = entries.slice(entries.findIndex((b) => b.entity.eid == out.input))
  return {
    asked: [...asked],
    cost: Math.round(
      mine.reduce(
        (sum, b) =>
          sum + Number((b.cost as { dollars?: number })?.dollars ?? 0),
        0,
      ) * 1000,
    ),
  }
}

test('the next turn is answered by the model the directory names, at its row’s price', async () => {
  await operatorOn(env, 'openai', 'gpt-6.1-sol', { input: 2, output: 8 })
  assertEquals(await turn(), { asked: ['openai gpt-6.1-sol'], cost: 2 })
  await operatorOn(env, 'anthropic', 'claude-opus-5-5', {
    input: 5,
    output: 25,
  })
  assertEquals(await turn(), { asked: ['anthropic claude-opus-5-5'], cost: 5 })
})

test('a space whose persona names its own model is answered by it, at the directory’s price', async () => {
  let own = personaFor(space.eid)
  await store.g.apply([{
    entity: { eid: own },
    using: {
      provider: identityEid('provider', ['openai']),
      model: identityEid('model', ['gpt-6.1-sol']),
    },
  }], { trusted: true })
  assertEquals(await turn(), { asked: ['openai gpt-6.1-sol'], cost: 2 })
  await store.g.apply([{ entity: { eid: own }, using: null }], {
    trusted: true,
  })
})

test('a conversation long enough to compact is summarized by the model the directory names, in its row’s window', async () => {
  await operatorOn(env, 'anthropic', 'claude-haiku-5-5', {
    input: 0.1,
    output: 0.5,
  }, 60_000)
  // A long message read nearly to its row's window fills the transcript.
  read = 59_000
  await turn('My garden: ' + 'tomatoes and beans. '.repeat(400))
  read = 1000
  assertEquals((await turn()).asked, [
    'anthropic claude-haiku-5-5 summary',
    'anthropic claude-haiku-5-5',
  ])
})
