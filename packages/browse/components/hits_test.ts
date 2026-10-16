// A picker filter keeps the complete bundles its domain renderers need.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { vocab } from '../types.ts'
import { config } from '../live.ts'
import { hits, rows } from './hits.ts'

let g = graph({ storage: ram(vocab), vocab })
g.apply([{
  entity: { eid: 'picker-session' },
  session: {},
  brief: { text: 'Ship the update' },
}])

test('filtered picker results retain the session brief for its tile', async () => {
  let prior = globalThis.fetch
  let host = config.host
  config.host = 'search.test'
  globalThis.fetch = (input) => {
    let q = new URL(String(input), 'http://search.test').searchParams.get('q')!
    return Promise.resolve(Response.json(g.read(q)))
  }
  try {
    let found = await rows('.session')
    assertEquals(found[0]?.brief, { text: 'Ship the update' })
  } finally {
    globalThis.fetch = prior
    config.host = host
  }
})

for (
  let [query, order] of [
    ['dragon .task', 'search'],
    ['dragon (.task .order=-created.at)', '-created.at'],
    ['.session', undefined],
  ] as const
) {
  test(`palette ranks words without overriding the query's order: ${query}`, async () => {
    let prior = globalThis.fetch
    let host = config.host
    config.host = 'search.test'
    let asked = ''
    globalThis.fetch = (input) => {
      asked = new URL(String(input), 'http://search.test').searchParams.get(
        'q',
      )!
      return Promise.resolve(Response.json([]))
    }
    try {
      await hits(query)
      let got = asked.match(/\.order=([^ )&]+)/g) ?? []
      assertEquals(got, order ? [`.order=${order}`] : [])
    } finally {
      globalThis.fetch = prior
      config.host = host
    }
  })
}
