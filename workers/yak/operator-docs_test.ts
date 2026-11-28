// What an Operator makes off the chat is a doc of its own
// (@yaks/platform/operator-docs): a phone call's notes are the caller's, found
// by their search, and their Update points to them; notes kept before only
// in an Update are moved into a doc once.
import { equal, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { textSearch } from '@yaks/graph/tools'
import {
  MADE_DOCS,
  madeBackfill,
  madeOf,
  POINTED,
  toldOf,
} from '@yaks/platform/operator-docs'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { handleChannels, receive } from './operator-channels.ts'
import { notesOf } from './operator-calls.ts'
import { notification, updatesOf } from './operator-updates.ts'
import { seenBy } from './operator-access.ts'
import { rootOf } from './operator-root.ts'

let NOTES = '- The barn opens Friday.'

let fixture = async () => {
  let { env } = platform('operator-docs')
  let person = crypto.randomUUID()
  let dir = directoryOf(env.STORE)
  let space = (await dir.at(
    await dir.mint(person, 'home', 'Home', {
      'x-yak-person': person,
      'x-yak-role': 'owner',
    }),
  ))!
  let store = operatorMemory()
  let operator = operating(
    store,
    env,
    operatorModel((req) =>
      Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: [{ kind: 'assistant', text: NOTES }],
        cost: 0,
      })
    ),
  )
  handleChannels(operator, env)
  return { store, operator, space, person }
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

test("a phone call's notes are a doc of the caller's, found by their search, which their Update points to", async () => {
  let { store, operator, space, person } = await fixture()
  let ticket = { person, via: 'telnyx', to: '+15550100' }
  let note = (text: string, o: { began?: boolean; said?: boolean }) =>
    operator.note({ person }, space, text, { call: 'c1', ...o })
  await note('', { began: true })
  await note('The barn opens Friday.', {})
  equal(await notesOf(store, space, ticket, 'c1', true), true)
  await drain(store)
  let [doc] = await store.g.read('.doc&.output&*')
  equal([comp(doc, 'doc'), comp(doc, 'owner')], [
    { title: 'Notes of your call', body: NOTES },
    { person },
  ])
  let [asked] = await store.g.get([String(comp(doc, 'output')?.source)])
  let [began] = await store.g.get([
    String(comp(asked, 'operator_request')?.about),
  ])
  equal(comp(began, 'operator_call'), { call: 'c1', began: true })
  let find = async (who: string) =>
    (await textSearch(seenBy(store, { person: who, member: true }))(
      'barn Friday',
    )).some((b) => b.entity.eid == doc.entity.eid)
  equal([await find(person), await find(crypto.randomUUID())], [true, false])
  let { updates } = await updatesOf(store, person, space.eid)
  equal(
    updates.map((u) => [u.subject, u.words, u.about, u.doc]),
    [[
      'Notes of your call',
      POINTED,
      doc.entity.eid,
      { title: 'Notes of your call', body: NOTES },
    ]],
  )
  // Searching their Updates reads the notes it points to.
  let found = async (q: string) =>
    (await updatesOf(store, person, space.eid, 50, { q })).updates.length
  equal([await found('barn friday'), await found('harbor')], [1, 0])
})

test('notes kept only as an Update are moved into a doc it points to, once', async () => {
  let { store, space, person } = await fixture()
  let held = new Map<string, string>()
  let marks = {
    get: (k: string) => held.get(k),
    set: (k: string, v: string) => void held.set(k, v),
  }
  let root = rootOf(space.eid, person)
  await store.g.apply([{
    entity: { eid: root },
    session: {},
    operator_session: { space: space.eid, person, conversation: true },
  }], { trusted: true })
  // As they were written before: the request, its answer, and the notice
  // holding the notes, a phone call's to the caller and a room's to all.
  let kept = async (to: string, title: string) => {
    let request = await receive(store, {
      space: space.eid,
      person,
      channel: 'notes',
    }, 'Ann: The barn opens Friday.')
    let answer = crypto.randomUUID()
    await store.g.apply([
      {
        entity: { eid: answer },
        operator_answer: { request, text: NOTES },
        delivered: { at: new Date().toISOString() },
      },
      notification({ to, subject: title, words: NOTES, id: answer }),
    ], { trusted: true })
    return answer
  }
  let phone = await kept(person, 'Notes of your call')
  let room = await kept(space.eid, 'Notes of the Discord call')
  let pass = () =>
    madeBackfill({ g: store.g, marks }, () => Promise.resolve(root))
  equal(await pass(), false)
  equal(held.get(MADE_DOCS), 'done')
  let docs = await store.g.get([madeOf(phone), madeOf(room)])
  equal(docs.map((b) => [comp(b, 'doc'), comp(b, 'owner')]), [
    [{ title: 'Notes of your call', body: NOTES }, { person }],
    [{ title: 'Notes of the Discord call', body: NOTES }, undefined],
  ])
  let told = await store.g.get([toldOf(phone), toldOf(room)])
  equal(
    told.map((b) => [comp(b, 'notification')?.about, comp(b, 'doc')?.body]),
    [[madeOf(phone), POINTED], [madeOf(room), POINTED]],
  )
  held.delete(MADE_DOCS)
  let before = await store.g.read('.doc&.output&*')
  equal(await pass(), false)
  equal(await store.g.read('.doc&.output&*'), before)
})
