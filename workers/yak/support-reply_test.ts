// TaskMaster's answer in a support thread an Operator opened (support-reply.ts)
// reaches that Operator conversation as a note it reads on its next turn, once,
// and starts no turn of its own; and only the person's own conversation takes
// it.
import { equal, ok, test } from '@yaks/testing'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { answer, open } from './support.ts'
import { carry, heard } from './support-reply.ts'
import { derivedEid } from '@yaks/graph/identity'

let { env } = platform('support-reply')
// The platform store the thread is kept in.
let kept = env.META!
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), space = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {}, doc: { title: 'Ada' } },
    { entity: { eid: space }, space: { slug: 'ada', store: 'ada' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space, role: 'owner' },
    },
  ],
}, owner)

let asked: Request[] = []
let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let service = operatorService(
  env,
  { person, role: 'owner', space },
  operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: reply('Noted.'),
      cost: 0.001,
    })
  }),
)
env.BUILDER = service.binding
let { store } = service
let chat = async (words: string) => {
  await receive(store, { space, person, channel: 'chat' }, words)
  await service.drain()
}
await chat('The board scrolls sideways; tell yaks.app.')

// The thread the conversation opened with feedback, and TaskMaster's answer.
let root = rootOf(space, person)
let words = 'Fixed: the board wraps on a phone now.'
let thread = await open(
  kept,
  env,
  { words: 'The board scrolls sideways.', person, session: root },
  { space, release: 'r', at: new Date().toISOString() },
  null,
  { 'x-yak-person': person },
)
let message = (await answer(
  kept,
  thread,
  { words },
  { 'x-yak-person': person },
))!
let turns = asked.length
// Carried twice, as a retried run is: kept once.
await carry(env, kept, message)
await carry(env, kept, message)
await service.drain()
let notes = await store.g.read(
  `.entry.session=${root}&.operator_channel.channel=support&*`,
)
await chat('Did they answer?')
let next = JSON.stringify(asked.at(-1)!.items)

test('the answer is a note in the conversation it came from, starting no turn', () => {
  equal(notes.length, 1)
  ok(notes[0].notice && notes[0].system)
  equal((notes[0].entry as { from: string }).from, 'TaskMaster')
  equal(asked.length, turns + 1, 'only the person’s next words asked a turn')
})

test('the next turn reads the answer once', () => {
  equal(next.split(words).length - 1, 1)
})

test("the person's Updates hold it too, linking the thread", async () => {
  let [told] = await store.g.get([
    derivedEid('operator-told|' + `support|${message}`),
  ])
  equal((told.deliver as { to: string }).to, person)
  equal((told.notification as { about: string }).about, thread)
  ok(String((told.doc as { body: string }).body).includes(`/support/${thread}`))
})

test("somebody else's conversation never takes it", async () => {
  let other = crypto.randomUUID()
  let took = await heard(store, {
    person: other,
    session: root,
    note: { eid: crypto.randomUUID(), body: 'not yours', by: null, via: null },
    update: { to: other, words: 'not yours' },
  })
  equal(took.session, null)
  equal(
    (await store.g.read(`.entry.session=${root}&.content.body=not yours`))
      .length,
    0,
  )
})
