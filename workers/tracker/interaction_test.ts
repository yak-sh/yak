import { equal, ok, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { reportInteractions } from '@yaks/platform/interaction-report'
import { interactionSummary, phases } from '@yaks/timing/interaction'
import { options, platform, store, vocab } from './core.ts'
import { batch, consume } from './queue.ts'

let now = Date.parse('2026-11-24T20:20:01Z')
let g = store(ram(vocab, options), { sink: () => {}, store: platform })
let point = (target: string, ms: number) => ({
  page: 'home',
  target,
  ms,
  ...phases(ms, 2, 110, 4),
})
let send = async (points: unknown[]) => {
  let kept: Bundle[][] = []
  let req = new Request('https://yaks.app/api/interaction', {
    method: 'POST',
    body: JSON.stringify({ id: crypto.randomUUID(), at: now, points }),
  })
  let res = await reportInteractions(req, {
    now: () => now,
    sink: (rows) => void kept.push(rows),
    failed: (err) => {
      throw err
    },
  })
  equal(res.status, 204)
  return kept
}

let fast = await send([point('open-gallery', 8), point('open-gallery', 16)])
let slow = await send([
  point('open-gallery', 100),
  point('open-gallery', 145),
  point('open-gallery', 158),
  point('open-pricing', 26),
])
let mixed = [...fast, ...slow, ...slow]
let ack = 0
await consume(
  mixed.map((body) => ({
    body,
    ack: () => ack++,
    retry: () => {
      throw Error('interaction batch unexpectedly retried')
    },
  })),
  (scope) => {
    equal(scope, platform)
    return g
  },
  (error) => Promise.reject(error),
  (_, error) => Promise.reject(error),
)
await g.drain()

test('a browser batch records exact thresholds and makes one bug per page and target', async () => {
  equal(batch(fast[0]).scope, platform)
  equal(ack, 3)
  let timing = interactionSummary(await g.graph.read('.timing *'))
  equal([timing.n, timing.under16, timing.under100], [6, 1, 3])
  equal(timing.kinds.map((p) => [p.name, p.max]), [
    ['home → open-gallery', 158],
    ['home → open-pricing', 26],
  ])
  let bugs = await g.bugs()
  equal(bugs.length, 1)
  equal((bugs[0].bug as Comp).hits, 2)
  let occurrences = await g.graph.read('.error *')
  for (let { error } of occurrences) {
    let tags = (error as Comp).tags as Comp
    equal([tags.page, tags.target, tags.server, tags.render, tags.input], [
      'home',
      'open-gallery',
      110,
      4,
      2,
    ])
  }
})

test('the platform digest includes interactions from its tracker store', async () => {
  await g.digest('test@example.test', now + 60_000)
  let [mail] = await g.graph.read('.mail *')
  let body = String((mail.doc as Comp).body)
  ok(body.includes('16.7% under 16 ms and 50.0% under 100 ms'))
  ok(body.includes('| home → open-gallery | 5 | 158 ms | 85 ms |'))
  ok(body.includes('Slow interaction'))
})

test('unrecognized coordinates cannot put someone’s contents in the tracker', async () => {
  equal(await send([point('my-password', 700)]), [])
  equal(await send([{ ...point('submit', 700), page: 'private-app-name' }]), [])
})

test('a reload is counted by its cause and files no bug, however long the page stood blank', async () => {
  for (
    let target of ['reload', 'reload-draft', 'reload-release', 'reload-away']
  ) {
    let [rows] = await send([point(target, 900)])
    equal(rows.map((r) => [!!r.timing, !!r.error]), [[true, false]])
  }
  equal(await send([point('reload-whatever', 900)]), [])
})

test('a reload nobody chose is filed to the tracker with its cause', async () => {
  for (let cause of ['discarded', 'unknown']) {
    let [rows] = await send([point(`reload-${cause}`, 40)])
    let [error] = rows.flatMap((r) => r.error ? [r.error as Comp] : [])
    equal(
      error.message,
      `Unexpected reload: home reloaded under the person (${cause}), blank 40 ms`,
    )
  }
})
