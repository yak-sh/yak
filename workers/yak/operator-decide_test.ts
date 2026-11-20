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
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'

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
    let sent = JSON.stringify(req.items)
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

test('with nothing waiting on them, their words carry no note', async () => {
  let notes = () =>
    store.g.read(
      line`.prompt.source=${'operator:decisions'}&.fields=entity.eid`,
    )
  let before = (await notes()).length
  await say('hi')
  assertEquals((await notes()).length, before)
})
