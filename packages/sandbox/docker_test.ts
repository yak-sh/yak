import { equal, test, throws } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { dockerSandboxes } from './docker.ts'
import { exportPath } from './provider.ts'

let vocab = loadVocab([])
let g = graph({ storage: ram(vocab), vocab })

test('Docker never falls back to the local computer on transport failure', async () => {
  let provider = dockerSandboxes(g, {
    state: '/state',
    transport: { execute: () => Promise.reject(new Error('fixture-offline')) },
  })
  await throws(() => provider.connect({ id: 'offline' }), 'fixture-offline')
})

test('sandbox exports refuse absolute and traversing paths before reading files', async () => {
  for (let path of ['/etc/passwd', '../key', 'dir/../key', 'dir/./key', '']) {
    await throws(
      () => exportPath(path),
      'Sandbox export paths must be relative',
    )
  }
  equal(exportPath('dist/out.bin'), 'dist/out.bin')
})
