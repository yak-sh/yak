// A request read in after its day ended is tallied by the next pass, unasked.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { listPrice } from '@yaks/model'
import { pass } from './service.ts'
import { tallied } from './tools.ts'
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

test('a request to an alias is weighed at the price of the release that answered it', async () => {
  let { graph } = await box()
  let [alias, release] = await graph.apply([
    { entity: { eid: '$a' }, model: { name: 'fable' } },
    { entity: { eid: '$r' }, model: { name: 'claude-fable-5-2' } },
  ])
  await graph.apply([{
    entity: { eid: 'q' },
    entry: { session: 's' },
    ask: { to: alias.entity.eid, served: release.entity.eid },
    usage: { input_tokens: 1e6, output_tokens: 0 },
  }])
  let unpriced = await pass(graph)
  let day = new Date().toISOString().slice(0, 10)
  let spend = (await graph.get([dayEid(day)]))[0].spend as { dollars: number }
  equal([unpriced, spend.dollars], [[], listPrice('claude-fable-5-2')!.input])
})

test('a tally on demand reads the requests the graph holds at their price now', async () => {
  let { graph, asked } = await box()
  let at = '2026-11-12T08:00:00.000Z', now = Date.parse(at)
  let [model] = await graph.apply([
    {
      entity: { eid: '$m' },
      model: { name: 'm' },
      price: { input: 4000, cached: 0, output: 0 },
    },
  ])
  await asked('a', at, model.entity.eid)
  equal(
    await tallied(graph, '2026-11-12', now),
    'tallied 1 days from 2026-11-12: 1 requests, $4.00',
  )
  await graph.apply([{
    entity: model.entity,
    price: { input: 8000, cached: 0, output: 0 },
  }])
  equal(
    await tallied(graph, '2026-11-12', now),
    'tallied 1 days from 2026-11-12: 1 requests, $8.00',
  )
})
