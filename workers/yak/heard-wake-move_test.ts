import { line } from '@yaks/query'
import { toolEid } from '@yaks/tools'
import type { Bundle } from '@yaks/graph'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Item } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { heardWakes } from './heard-wake-move.ts'
import { HEARD_WAKES } from './wake-move.ts'

// Wakes kept before a steered turn's wakes carried its mark (T-3472): each
// whose call is a privileged act is judged by the turn that set it.
let { env } = platform('heard-wake-move')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {}, doc: { title: 'Jeff Peterson' } },
    { entity: { eid }, space: { slug: 'jeff', store: 'jeff' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, owner)

// Words naming whom to add set a wake that adds them, or only says to.
let service = operatorService(
  env,
  { person, role: 'owner', space: eid },
  operatorModel((req) => {
    let said = req.items.findLast((i) => i.kind == 'user')
    let words = said?.kind == 'user' ? said.text : ''
    let who = words.match(/add (\w+)/)?.[1]
    let args = words.includes('say') ? { say: `Add ${who}`, at: '10m' } : {
      tool: 'member_add',
      args: { email: `${who}@x.example`, role: 'owner' },
      at: '10m',
    }
    let items: Item[] = req.items.at(-1)?.kind == 'result' || !who
      ? [{ kind: 'assistant', text: 'Done.' }]
      : [{
        kind: 'call',
        id: crypto.randomUUID(),
        name: 'wake_set',
        args: JSON.stringify(args),
      }]
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      cost: 0,
    })
  }),
)
env.BUILDER = service.binding
let { store } = service

// The wake words on `channel` set, kept as before the fix kept it: unmarked.
let set = async (channel: string, say: string) => {
  let before = new Set(
    (await store.g.read(line`.wake.for=${person}`)).map((b) => b.entity.eid),
  )
  await receive(store, { space: eid, person, channel }, say)
  await service.drain()
  let [wake] = (await store.g.read(line`.wake.for=${person}&*`))
    .filter((b: Bundle) => !before.has(b.entity.eid))
  await store.g.apply([{ entity: wake.entity, heard: null }], { trusted: true })
  return wake.entity.eid
}

let own = await set('chat', 'In ten minutes, add ann')
let relayed = await set('machine', 'In ten minutes, add bob')
let texted = await set('text', 'In ten minutes, add cat')
let words = await set('machine', 'Later, say: add dan')
// A wake whose setting turn is gone.
let lost = crypto.randomUUID()
await store.g.apply([{
  entity: { eid: lost },
  wake: { at: new Date(Date.now() + 6e5).toISOString(), for: person },
  call: { to: toolEid('member_add'), args: {} },
}], { trusted: true })

let kept = new Map<string, string>()
let marks = {
  get: (k: string) => kept.get(k),
  set: (k: string, v: string) => void kept.set(k, v),
}
let soon = new Date(Date.now() + 6e4).toISOString()
let judged = await heardWakes({ g: store.g, marks }, soon)
let heard = new Set(
  (await store.g.read('.wake&.heard&.fields=entity.eid')).map((b) =>
    b.entity.eid
  ),
)

test('a wake a stranger may have set, or whose turn is gone, is marked heard', () => {
  assertEquals(judged?.checked, 4)
  assertEquals(new Set(judged?.marked), new Set([relayed, texted, lost]))
  assertEquals(heard, new Set([relayed, texted, lost]))
  assertEquals([own, words].some((w) => heard.has(w)), false)
  assertEquals(kept.get(HEARD_WAKES), 'done')
})

test('a store judges its wakes once', async () => {
  assertEquals(await heardWakes({ g: store.g, marks }, soon), undefined)
})
