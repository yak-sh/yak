// A store's tool imports become anatomy evidence when a caller asks it to run.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { storedTools } from './package-tools.ts'

let vocab = loadVocab([{
  $defs: {
    connection: {
      component: true,
      properties: { owner: { type: 'string' } },
    },
  },
}])
let host = { graph: graph({ vocab, storage: ram(vocab) }) } as Host

test('stored package tools observe import and binding on the first call', async () => {
  let imports: unknown[][] = [], implementations: unknown[][] = []
  let tools = storedTools(host, 'directory', undefined, {
    attempted: (...args) => imports.push(['attempted', ...args]),
    loaded: (...args) => imports.push(['loaded', ...args]),
    runs: (...args) => implementations.push(args),
  })
  let listing = tools.find((t) => t.name == 'connection_list')!
  equal(imports, [])
  equal(implementations, [])
  let call = { entity: { eid: 'ask' }, call: { args: { owner: 'space' } } }
  equal(await listing.run(call, host.graph), [])
  equal(imports, [
    ['attempted', '@yaks/connections', 'tools'],
    ['loaded', '@yaks/connections', 'tools', true],
  ])
  equal(implementations.length, 1)
  let [owner, loaded, bound] = implementations[0]
  equal(owner, '@yaks/connections')
  equal((loaded as string[]).includes(listing.name), true)
  equal(bound, loaded)
  await listing.run(call, host.graph)
  equal(imports.length, 2)
  equal(implementations.length, 1)
})
