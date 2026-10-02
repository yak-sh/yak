import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { roles } from './roles.ts'

test('a repeated role runs its service once per pass', async () => {
  let vocab = loadVocab([])
  let g = graph({ storage: ram(vocab), vocab })
  let calls = 0
  let host = roles(g, {
    me: 'thread',
    roles: ['clock', 'clock'],
    services: {
      clock: () => {
        calls++
      },
    },
  })
  try {
    await host.duties(AbortSignal.abort())
    equal(calls, 1)
  } finally {
    await host.close()
  }
})
