// A request read in after its day ended is tallied by the next pass, unasked.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { listPrice } from '@yaks/model'
import { pass } from './service.ts'
import { dayEid } from './window.ts'

let box = async () => {
  let { graph } = await compose({
    db: ':memory:',
    person: 'owner',
    plugins: [
      '@yaks/kernel',
      '@yaks/provenance',
      '@yaks/id',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/task',
      '@yaks/session',
      '@yaks/model',
      '@yaks/spend',
    ],
  }, ['graph'])
  await graph.apply([{ entity: { eid: 's' }, session: { id: 's' } }])
  let asked = (eid: string, now?: string, to?: string) =>
    graph.apply([{
      entity: { eid },
      entry: { session: 's' },
      ask: to ? { to } : {},
      usage: { input_tokens: 1000, output_tokens: 10 },
    }], now ? { now } : {})
  let requests = async (day: string) =>
    ((await graph.get([dayEid(day)]))[0]?.spend as { requests?: number })
      ?.requests
  let owed = async () =>
    (await graph.read('.untallied .fields=untallied.day')).map((b) =>
      (b.untallied as { day: string }).day
    )
  return { graph, asked, requests, owed }
}

test('a day read in late is owed a tally, and the next pass takes it', async () => {
  let { graph, asked, requests, owed } = await box()
  await asked('a', '2026-10-20T12:00:00.000Z')
  await asked('b', '2026-10-20T13:00:00.000Z')
  await asked('c', '2026-10-21T09:00:00.000Z')
  equal((await owed()).sort(), ['2026-10-20', '2026-10-21'])
  await pass(graph, Date.parse('2026-10-25T12:00:00Z'))
  equal([await requests('2026-10-20'), await requests('2026-10-21')], [2, 1])
  equal(await owed(), [])
})

test('a request made today owes nothing: every pass tallies today', async () => {
  let { asked, owed } = await box()
  await asked('a')
  equal(await owed(), [])
})

test('a model row with no price takes its list price when a tally meets it', async () => {
  let { graph, asked } = await box()
  let priced = async (name: string) => {
    let [{ entity }] = await graph.apply([
      { entity: { eid: '$m' }, model: { name } },
    ])
    await graph.apply([{ entity, price: null }])
    await asked(name, undefined, entity.eid)
    let unpriced = await pass(graph)
    return [(await graph.get([entity.eid]))[0].price, unpriced.length]
  }
  equal(await priced('claude-opus-4-8[1m]'), [listPrice('claude-opus-4-8'), 0])
  equal(await priced('no-such-model'), [undefined, 1])
})
