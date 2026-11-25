// A conversation a yaks.app bug stopped is taken up again once the bug is
// fixed, once, and its person is told so with what came of it.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { line as q } from '@yaks/query'
import { ModelError } from '@yaks/model'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { breakTask, handleChannels, receive } from './operator-channels.ts'
import { rerun } from './operator-rerun.ts'
import { conversationOf } from './operator-host.ts'
import { within } from './defects.ts'
import { faultOf } from '@yaks/tracker'

let reports: Bundle[] = []
let p = platform('operator-rerun')
p.env.ERRORS = { send: (rows) => (reports.push(...rows), Promise.resolve()) }
let owner = crypto.randomUUID()
let space = await directoryOf(p.env.STORE).mint(owner, 'reran', 'Reran', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let broken = true
// A step that throws, not a model's refusal: a query yaks.app wrote, refused
// by a directory a deploy reached first, carries a refusal's status.
let threw: Error | undefined
let heard: string[] = []
let store = operatorMemory()
let operator = operating(
  store,
  p.env,
  operatorModel((req) => {
    heard.push(JSON.stringify(req.items))
    if (threw) throw threw
    if (broken) throw new ModelError('claude_tool', 'an unoffered tool')
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Your app is built.' }],
      cost: 0.001,
    })
  }),
)
handleChannels(operator, p.env)
let run = <T>(work: () => Promise<T>) => within(p.env, {}, work)

// The conversations stalled now, each with the fault it was filed under.
let stalled = async () =>
  (await store.g.read(q`.stalled .fields=stalled.fault`)).map((b) => ({
    session: b.entity.eid,
    fault: String((b.stalled as Comp).fault),
  }))

await run(async () => {
  await receive(store, { space, person: owner, channel: 'chat' }, 'Build it')
  await drain(store)
})
let tags = reports.map((r) => (r.error as Comp).tags as Record<string, string>)
  .find((t) => t.request == 'operator conversation')!
let [stall] = await stalled()
broken = false
let said = { cause: 'Claude named a tool bare', recur: 'no' }
let fixed = { faults: [stall.fault], bug: 'b1', said }
let made = await run(async () => {
  let made = await rerun(store, space, fixed)
  await drain(store)
  return made
})
let told = await store.g.read(q`.notification.to=${owner} .fields=doc`)
let stuck = await store.g.read(q`.effect.state=failed .fields=effect.handler`)

test("a conversation's report names its space, and the conversation keeps the fault it was filed under", () => {
  assertEquals(tags.rerun, space)
  assertEquals(stall, {
    session: tags.session,
    fault: faultOf(
      reports.find((r) => (r.error as Comp).tags == tags as unknown)!,
    ),
  })
})

test('a fixed bug takes the conversation up again, telling the model what went wrong', async () => {
  assertEquals([made.length, stuck, await stalled()], [1, [], []])
  assertStringIncludes(heard.at(-1)!, 'that problem is now fixed')
  assertStringIncludes(heard.at(-1)!, said.cause)
})

test('its person is told once, in plain words, that yaks.app failed and it started again; what came of it stays in its chat', () => {
  assertEquals(told.length, 1)
  assertStringIncludes(String((told[0].doc as Comp).body), 'started again')
  assertEquals(JSON.stringify(told).includes('Your app is built.'), false)
})

test('the same fix handed back again asks nothing more', async () => {
  assertEquals(await rerun(store, space, fixed), [])
})

test("a break's task a bug stopped is taken up in its own conversation, and its person told about the task", async () => {
  broken = true
  let fix = crypto.randomUUID()
  let app = crypto.randomUUID()
  await run(async () => {
    await receive(
      store,
      { space, person: owner, channel: 'error', app },
      'Fix this error in cookbook',
      { id: fix },
    )
    await drain(store)
  })
  let [{ fault }] = await stalled()
  broken = false
  await run(async () => {
    await rerun(store, space, { faults: [fault], bug: 'b2', said })
    await drain(store)
  })
  let task = breakTask(app)
  let notes = await store.g.read(
    q`.notification.about=${task}&.notification.to=${owner} .fields=doc`,
  )
  assertEquals(notes.length, 1)
  assertStringIncludes(String((notes[0].doc as Comp).body), 'started again')
  assertEquals((await store.g.read(q`.contains .edge.from=${task}`)).length, 1)
})

test("a turn that threw is filed under its conversation, even with a refusal's status, and stalls until its fix", async () => {
  let presence = 'unknown prop: .presence (closest declared: .ref.present)'
  threw = Object.assign(new Error(presence), { status: 400 })
  await run(async () => {
    await receive(store, { space, person: owner, channel: 'chat' }, 'Hi')
    await drain(store)
  })
  threw = undefined
  let filed = reports.filter((r) =>
    ((r.error as Comp).tags as Record<string, string>).request ==
      'operator conversation' && JSON.stringify(r).includes(presence)
  )
  assertEquals(filed.length, 1)
  let [stall] = await stalled()
  assertEquals(stall.fault, faultOf(filed[0]))
  let page = await conversationOf(store, '/operator', stall.session)
  assertStringIncludes(page.html, 'taken up again once the problem is fixed')
  assertEquals(page.html.includes('Send your message again'), false)
  await run(async () => {
    await rerun(store, space, { faults: [stall.fault], bug: 'b3', said })
    await drain(store)
  })
  assertEquals(await stalled(), [])
})
