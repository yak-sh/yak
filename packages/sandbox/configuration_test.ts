// Configured adapters select explicit computer rows and fail before external work.
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { machineDoc } from '@yaks/machine/vocab'
import { equal, test, throws } from '@yaks/testing'
import { resolveOptions } from './configuration.ts'
let vocab = loadVocab([kernelDoc, machineDoc])
let g = graph({ storage: ram(vocab), vocab })
let local = mint(), remote = mint(), unknown = mint()
await g.apply([
  { entity: { eid: local }, machine: { address: 'local://' } },
  { entity: { eid: remote }, machine: { address: 'ssh://coder@example.test' } },
  { entity: { eid: unknown }, machine: {} },
])
let host = { graph: g }
let configured = await resolveOptions(host, {
  providers: {
    docker: {
      machine: remote,
      use: '@yaks/sandbox/docker',
      with: { state: '/state/yak' },
    },
  },
})
test('JSON sandbox binding constructs an adapter for the selected SSH computer without connecting', () => {
  equal(configured.providers.docker.machine, remote)
  equal(typeof configured.providers.docker.provider.request, 'function')
})
test('sandbox configuration never supplies an implicit local computer', async () => {
  await throws(() =>
    resolveOptions(host, {
      providers: {
        docker: { use: '@yaks/sandbox/docker', with: { state: '/state/yak' } },
      },
    })
  )
  await throws(() =>
    resolveOptions(host, {
      providers: {
        docker: {
          use: '@yaks/sandbox/docker',
          machine: unknown,
          with: { state: '/state/yak' },
        },
      },
    })
  )
  await throws(() =>
    resolveOptions(host, {
      providers: {
        docker: {
          use: '@yaks/sandbox/docker',
          machine: mint(),
          with: { state: '/state/yak' },
        },
      },
    })
  )
})
test('PVE JSON binding requires its explicit reserved pool', async () => {
  await throws(() =>
    resolveOptions(host, {
      providers: {
        pve: {
          use: '@yaks/sandbox/pve',
          machine: local,
          with: { state: '/state/yak' },
        },
      },
    })
  )
})
