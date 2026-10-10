// Bug reads cross the signed Worker door while remote entities stay outside
// the box graph. The declared tools exercise the same arguments as CLI/MCP.
import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ids as addresses } from '@yaks/id/graph'
import { idDoc } from '@yaks/id/vocab'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { runner, toolEid } from '@yaks/tools'
import { valueIn } from '@yaks/tools/value'
import { door } from '../../workers/tracker/door.ts'
import { options, platform, store, vocab } from '../../workers/tracker/core.ts'
import { trackerDoc } from './vocab.ts'
import { runs } from './tools.ts'
import { routes } from './routes.ts'
import { sign } from './ticket.ts'

let ids = [1, 2, 3, 4, 5].map((n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
)
let remote = store(ram(vocab, options), { sink: () => {} })
let boxVocab = loadVocab([...vocab.docs, idDoc], vocab.keywords)
let box = graph({
  vocab: boxVocab,
  storage: ram(boxVocab, options),
  plugins: [addresses(boxVocab)],
})
await remote.graph.apply([
  ...[3, 8, 20].map((hits, i) => ({
    entity: { eid: ids[i] },
    doc: { title: `platform problem ${i}` },
    bug: { fault: `test-${i}`, hits },
    ...i == 2 ? { resolved: {} } : {},
  })),
  {
    entity: { eid: ids[3] },
    error: { bug: ids[1], at: '2026-10-01T00:00:00Z' },
  },
], { trusted: true })
await box.apply([{
  entity: { eid: ids[4] },
  bug: { fault: 'box', hits: 1 },
  doc: { title: 'box problem' },
}], { trusted: true })
let before = await box.read('.entity *')
let config = { remote: { url: 'https://tracker.test', secret: 'test-only' } }
let token = await sign({
  scope: platform,
  person: 'test',
  admin: true,
  exp: Date.now() / 1000 + 60,
}, config.remote.secret)
let upstream = door(remote, platform, config.remote.secret)
let go = ((url, init) => upstream(new Request(url, init))) as typeof fetch
let read = runner(box, {
  tools: loadTools(trackerDoc, runs({}, config, go)),
}).read
let ask = (name: string, args: Record<string, unknown> = {}) =>
  read({
    entity: { eid: ids[4] },
    call: { to: toolEid(name), args },
  })
let rows = (answer: Bundle[]) => valueIn(answer)?.rows as Bundle[]

test('platform bug list filters and sorts before its limit without importing rows', async () => {
  let answer = await ask('bug_list', { source: 'yaks.app', limit: 1 })
  equal(valueIn(answer)?.source, 'yaks.app')
  equal(rows(answer).map((b) => b.entity.eid), [ids[1]])
  ok(
    String(answer[0].content && (answer[0].content as { body: string }).body)
      .includes('yaks.app'),
  )
  equal(await box.read('.entity *'), before)
})
test('platform bug list applies the caller query and order at the remote store', async () => {
  let answer = await ask('bug_list', {
    source: 'yaks.app',
    query: '.bug .order=bug.hits',
    limit: 2,
  })
  equal(valueIn(answer)?.source, 'yaks.app', JSON.stringify(answer))
  equal(rows(answer).map((b) => b.entity.eid), [ids[0], ids[1]])
})
test('platform bug show reads retained occurrences without local ids or writes', async () => {
  equal(
    rows(await ask('bug_show', { source: 'yaks.app', bug: ids[1] }))
      .map((b) => b.entity.eid),
    [ids[1], ids[3]],
  )
  equal(await box.read('.entity *'), before)
})
test('box bug reads still resolve numbered ids and titles locally', async () => {
  let [bug] = await ask('bug_list')
  equal(bug.entity.eid, ids[4])
  equal((await ask('bug_show', { bug: `B-${bug.entity.num}` }))[0], bug)
  equal((await ask('bug_show', { bug: 'box problem' }))[0], bug)
})
test('remote reads refuse box numbers and invalid limits explicitly', async () => {
  ok(
    (await ask('bug_show', { source: 'yaks.app', bug: 'B-1' })).some((b) =>
      b.refusal
    ),
  )
  ok(
    (await ask('bug_list', { source: 'yaks.app', limit: 101 })).some((b) =>
      b.refusal
    ),
  )
})
test('missing platform bugs and unavailable configuration are explicit failures', async () => {
  ok(
    (await ask('bug_show', { source: 'yaks.app', bug: ids[4] })).some((b) =>
      b.refusal
    ),
  )
  await throws(() =>
    runs().bug_list({
      entity: { eid: ids[4] },
      call: { args: { source: 'yaks.app' } },
    }, box)
  )
})
test('the box bug door forwards app filters', async () => {
  let route = routes({}, config, go).find((r) => r.path == '/tracker/bugs')!
  let response = await route.handle(
    new Request(`http://box/tracker/bugs?app=${ids[4]}`),
  )
  equal(await response.json(), [])
})

test('empty app on the authenticated bugs door retains its all-app meaning', async () => {
  let route = routes({}, config, go).find((r) => r.path == '/tracker/bugs')!
  equal(
    (await (await route.handle(new Request('http://box/tracker/bugs?app=')))
      .json()).length,
    3,
  )
})
test('authenticated bugs reads expose no write route', async () => {
  equal(
    (await upstream(
      new Request('https://tracker.test/bugs', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )).status,
    404,
  )
})
