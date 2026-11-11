// A write through the tools is answered with what the graph's person said
// and decided before that bears on it, once a floor lets anything near: the
// host composes this plugin's reply into its one runner (@yaks/cli `compose`).

import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import { compose } from '@yaks/cli/host'
import { fields, hashEmbedder, searched, sweep } from '@yaks/embedding'
import { answerOf, toolEid } from '@yaks/tools'

let SAID = 'texts to the church landline forward to email'

// A graph whose person is Ada, holding what she and a script said and what
// was decided, each with its vector.
let open = async () => {
  let yak = await compose({
    db: ':memory:',
    numbers: false,
    person: 'ada',
    plugins: [
      '@yaks/kernel',
      '@yaks/provenance',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/task',
      '@yaks/memory',
      '@yaks/persona',
      { use: '@yaks/embedding', with: { embedder: { provider: 'hash' } } },
    ],
  }, ['graph'])
  let comment = (eid: string, body: string, by: string): Bundle => ({
    entity: { eid },
    comment: { target: 'line' },
    doc: { body },
    $actor: { by },
  })
  let decision = (
    eid: string,
    question: string,
    rest: Bundle | object = {},
  ) => ({
    entity: { eid },
    task: {},
    doc: { title: question },
    decision: {
      question,
      choices: ['yes', 'no'].map((label) => ({ label, description: label })),
      recommended: 'yes',
    },
    ...rest,
  })
  await yak.graph.apply([
    { entity: { eid: 'ada' }, person: {}, doc: { title: 'Ada' } },
    { entity: { eid: 'bot' }, doc: { title: 'a script' } },
    { entity: { eid: 'run' }, doc: { title: 'its run' } },
    { entity: { eid: 'line' }, task: {}, doc: { title: 'The church line' } },
  ])
  await yak.graph.apply([
    comment('hers', SAID, 'ada'),
    comment('its', SAID, 'bot'),
    comment('far', 'paint the garden shed green', 'ada'),
    decision('settled', `Should ${SAID}?`, { decided: { choice: 'yes' } }),
    decision('unsettled', `Should ${SAID} now?`),
  ])
  await sweep(
    yak.storage.statements,
    fields(yak.vocab, searched),
    hashEmbedder(),
  )
  return yak
}

let call = async (
  yak: Awaited<ReturnType<typeof open>>,
  actor: { by?: string; via?: string },
) => {
  await yak.runner.ensure(['task_new'])
  let id = mint()
  return answerOf(
    await yak.runner.call({
      entity: { eid: id },
      call: { to: toolEid('task_new'), args: { title: `Check ${SAID}` } },
      $actor: actor,
    }),
    id,
  )
}

let said = (answer: Bundle[]) =>
  answer.filter((b) => (b.hit as Comp | undefined)?.said)

// The door is off (SAID in ./earlier.ts) until a scored variant earns it.
test('a task an agent files is answered with nothing the person said or decided', async () => {
  let yak = await open()
  try {
    equal(said(await call(yak, { by: 'bot', via: 'run' })), [])
  } finally {
    await yak.close()
  }
})
