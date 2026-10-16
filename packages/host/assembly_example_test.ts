import { assembly, type Load } from '@yaks/host'
import { effects } from '@yaks/effects'
import { memoryBlobs } from '@yaks/blob'
import { ram } from '@yaks/ram'
import { ramVault } from '@yaks/secrets'
import { equal, test } from '@yaks/testing'

let load: Load = () => Promise.resolve(null)
let plan = await assembly({ plugins: [] }, ['graph'], load, {
  docs: [{
    $defs: {
      book: { component: true, properties: { title: { type: 'string' } } },
    },
  }],
})
let blobs = memoryBlobs()
test('the portable binding example writes and reads through its bound host', async () => {
  let { host } = plan.bind({
    host: {
      me: 'example',
      vault: ramVault(),
      blobs,
      artifacts: blobs,
      stopping: new AbortController().signal,
      duties: () => Promise.resolve(),
      end: () => Promise.resolve(),
      bury: () => Promise.resolve([]),
      gone: () => Promise.resolve(false),
    },
    storage: (host) => ram(host.vocab),
    effects: (host, disabled) =>
      effects(host.vocab, {
        disabled,
        owes: 'declared',
        write: (bundles) => host.graph.apply(bundles),
      }),
  })
  await host.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
  equal((await host.graph.get(['b']))[0].book, { title: 'Dune' })
})
