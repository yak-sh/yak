// The composed HTTP handler reads and writes its graph in this process.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { compose, facet } from './host.ts'

let endpoints = await (async () => {
  let host = await compose(
    {
      db: ':memory:',
      plugins: [
        '@yaks/api',
        '@yaks/mcp',
        '@yaks/kernel',
        '@yaks/provenance',
        '@yaks/id',
        '@yaks/session',
        '@yaks/harness',
        '@yaks/process',
      ],
      numbers: false,
    },
    ['graph', 'web'],
    (plugin, name) => facet(plugin, name),
  )
  assert(host.handler, 'a config naming @yaks/api composed no handler')
  assert(host.tools.some((t) => t.name == 'serve'), 'no serve verb')
  let request = (path: string, init?: RequestInit) =>
    Promise.resolve(host.handler!(new Request(`http://host${path}`, init)))
  try {
    let listed = await (await request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    })).json()
    let names = listed.result.tools.map((t: { name: string }) => t.name)

    let applied = await (await request('/apply', {
      method: 'POST',
      body: JSON.stringify([{
        entity: { eid: 'boot-session' },
        session: { id: 'one' },
      }]),
    })).json()
    let found = await (await request('/query?q=.session.id=one')).json()
    return { names, applied, found, me: host.me }
  } finally {
    await host.close()
  }
})()

test('a composed host answers through its endpoints and carries the serve verb', () => {
  let { names, applied, found, me } = endpoints
  assert(names.includes('session_list'), names.join(' '))
  assert(names.includes('graph_apply'), names.join(' '))
  assertEquals(applied[0].created.by, me)
  assertEquals(found[0].entity.eid, 'boot-session')
  assertEquals(found[0].session.status, 'empty')
})
