// An interruption is attributed by the graph and can be removed for retry.

import { test } from '@yaks/testing'
import { equal } from '@yaks/testing'
import { comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from './vocab.ts'
import { kernel } from './plugin.ts'

test('interruption records its writer and removal permits a retry', async () => {
  let vocab = loadVocab([kernelDoc], [kernelKeywords])
  let g = graph({ storage: ram(vocab), vocab, plugins: [kernel()] })
  await g.apply([{ entity: { eid: 'writer' } }])
  await g.apply([{
    entity: { eid: 'request' },
    interrupted: { code: 'restart' },
    $actor: { by: 'writer', via: 'writer' },
  }])
  let [row] = await g.get(['request'])
  let mark = comp(row, 'interrupted')
  equal(mark?.code, 'restart')
  equal(mark?.by, 'writer')
  equal(mark?.via, 'writer')
  equal(typeof mark?.at, 'string')
  await g.apply([{ entity: row.entity, interrupted: null }])
  equal((await g.get(['request']))[0].interrupted, undefined)
})
