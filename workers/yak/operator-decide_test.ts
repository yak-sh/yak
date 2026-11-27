// A person answers their Operator's question by talking with it
// (operator-relay.ts `decisionRelay`): the decisions waiting on them are a
// note beside their words, and the one their message answers is closed as
// theirs, citing that message.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Item } from '@yaks/model'
import { line } from '@yaks/query'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService, promptOf } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { updatesOf } from './operator-updates.ts'

let p = platform('operator-decide')
let [ada, eid] = [crypto.randomUUID(), crypto.randomUUID()]
await directoryOf(p.env.STORE).apply({
  entities: [
    { entity: { eid: ada }, person: {}, doc: { title: 'Ada' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: ada, space: eid, role: 'owner' },
    },
    { entity: { eid }, space: { slug: 'club', store: 'club' } },
  ],
}, { 'x-yak-person': ada, 'x-yak-role': 'owner' })

let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let said = (text: string): Item[] => [{ kind: 'assistant', text }]
let asking = (question: string) =>
  call('decision_new', {
    question,
    choices: [
      { label: 'Gothic', description: 'Dark serif cover' },
      { label: 'Plain', description: 'White cover' },
    ],
    recommended: 'Plain',
  })
// Each person's message is answered by its own steps: the model reads the
// decision's id from the note it was given.
let replies: ((sent: string) => Item[])[] = []
let service = operatorService(
  p.env,
  { person: ada, role: 'owner', space: eid },
  operatorModel((req) => {
    let sent = promptOf(req)
    let next = replies.shift()
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: next ? next(sent) : said('Done.'),
      cost: 0.001,
    })
  }),
)
let { store } = service
let idOf = (sent: string, question: string) =>
  sent.match(new RegExp(`- (\\S+): ${question}`))![1]
let say = async (text: string) => {
  await receive(store, { space: eid, person: ada, channel: 'chat' }, text)
  await service.drain()
}
let decision = async (question: string) =>
  (await store.g.read(line`.decision.question=${question}&*`))[0]

// Asked, then answered in chat.
let ask = async (question: string, answer: string, args: object) => {
  replies.push(() => asking(question), () => said('Asked.'))
  await say('Make a cover')
  let notes: string[] = []
  replies.push(
    (sent) => {
      notes.push(sent)
      return call('decision_relay', { decision: idOf(sent, question), ...args })
    },
    () => said('Recorded.'),
  )
  await say(answer)
  return { row: await decision(question), note: notes[0] }
}

test('a message that picks a choice closes the decision as theirs, citing it', async () => {
  let { row, note } = await ask('Which cover?', 'go with the gothic one', {
    choice: 'gothic',
  })
  assertStringIncludes(
    note,
    'Which cover? \\"Gothic\\", \\"Plain\\" (recommended)',
  )
  let decided = row.decided as Comp
  assertEquals([decided.choice, decided.by], ['Gothic', ada])
  let [cite] = await store.g.read(
    line`.cites .edge.from=${row.entity.eid}&*`,
  )
  let [message] = await store.g.get([String((cite.edge as Comp).to)])
  assertStringIncludes(
    String((message.content as Comp).body),
    'go with the gothic one',
  )
})

test('an answer in their own words is the answer', async () => {
  let { row } = await ask('Which font?', 'something rounder', {})
  assertEquals((row.decided as Comp).choice, 'something rounder')
})

test('relaying another answer returns the recorded answer and adds no citation', async () => {
  let question = 'Which badge?'
  let { row } = await ask(question, 'go with the plain one', {
    choice: 'Plain',
  })
  let original = row.decided as Comp
  let citations = () =>
    store.g.read(line`.cites .edge.from=${row.entity.eid}&*`)
  let before = await citations()
  let returned = ''
  replies.push(
    () =>
      call('decision_relay', {
        decision: row.entity.eid,
        choice: 'Gothic',
        entry: 'ignored on retry',
      }),
    (sent) => {
      returned = sent
      return said('Kept the answer.')
    },
  )
  await say('go with gothic')
  assertStringIncludes(
    returned,
    `was already answered with \\"Plain\\" at ${original.at}`,
  )
  assertEquals((await decision(question)).decided, original)
  assertEquals(await citations(), before)
})

test('with nothing waiting on them, their words carry no note', async () => {
  let notes = () =>
    store.g.read(
      line`.prompt.source=${'operator:decisions'}&.fields=entity.eid`,
    )
  let before = (await notes()).length
  await say('hi')
  assertEquals((await notes()).length, before)
})

// A decision waiting on someone else, or a task that is no decision, is
// refused with whose it is and the decisions that do wait on the person.
test('relaying what is not theirs names whose it is and what waits on them', async () => {
  let [bo, theirs, plain] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ]
  await directoryOf(p.env.STORE).apply({
    entities: [{
      entity: { eid: bo },
      person: {},
      doc: { title: 'Bo' },
      email: { address: 'bo@example.com' },
    }],
  }, { 'x-yak-person': ada, 'x-yak-role': 'owner' })
  await store.g.apply([
    {
      entity: { eid: theirs },
      task: {},
      doc: { title: 'Which mug?' },
      decision: {
        question: 'Which mug?',
        choices: [{ label: 'Red' }, { label: 'Blue' }],
        recommended: 'Red',
      },
      filed: { assignee: bo },
    },
    { entity: { eid: plain }, task: {}, doc: { title: 'Wash mugs' } },
  ], { trusted: true })
  replies.push(() => asking('Which cup?'), () => said('Asked.'))
  await say('Make a cup')
  let refused: string[] = []
  for (let named of [theirs, plain]) {
    replies.push(
      () => call('decision_relay', { decision: named, choice: 'Red' }),
      (sent) => {
        refused.push(sent)
        return said('Noted.')
      },
    )
    await say('red')
  }
  assertStringIncludes(
    refused[0],
    'waits on Bo, not on the person you are talking with',
  )
  assertStringIncludes(refused[1], 'is not a decision.')
  for (let sent of refused) {
    assertStringIncludes(
      sent,
      'The decisions waiting on the person you are talking with:',
    )
    assertStringIncludes(sent, 'Which cup?')
  }
})

test('a choice the Operator made is kept as its own, beside the session, and asks the person nothing', async () => {
  let question = 'How does the game look?'
  replies.push(
    () =>
      call('decision_record', {
        question,
        choices: [
          { label: '3D', description: 'A lit scene and a following camera' },
          { label: '2D', description: 'A flat board seen from above' },
        ],
        chose: '2D',
        why: 'A board game reads best from above',
      }),
    () => said('Making it 2D.'),
  )
  await say('Make me a checkers game')
  let row = await decision(question)
  let decided = row.decided as Comp
  assertEquals(decided.choice, '2D')
  assertEquals(decided.by == ada, false)
  let [session] = await store.g.read(
    line`.session&.entity.eid=${String(decided.via)}&*`,
  )
  assertEquals(!!session, true)
  let { updates } = await updatesOf(store, ada, eid)
  assertEquals(updates.some((u) => u.words == question), false)
})
