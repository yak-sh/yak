// Which components a read answers with: the ones its query names.

import { assertEquals } from '@std/assert'
import { loadVocab, type PropSchema } from '@yaks/vocab'
import { wanted } from './projection.ts'

let comp = (properties: Record<string, PropSchema> = {}) => ({
  component: true,
  type: 'object',
  properties,
})

// `module` is a component, and a property of `symbol` too.
let vocab = loadVocab([{
  $defs: {
    file: comp({ path: { type: 'string' } }),
    module: comp({ blob: { type: 'string' } }),
    symbol: comp({ module: { type: 'string' } }),
    doc: comp({ title: { type: 'string' } }),
  },
}])

let asks = (query: string) => [...wanted(vocab, query) ?? ['*']].sort()

Deno.test('a read answers the components its query names', () => {
  for (
    let [query, comps] of [
      ['.file', ['file']],
      ['.file&?doc', ['doc', 'file']],
      ['.file&?module', ['file', 'module']],
      ['.module&.symbol.module=m1', ['module', 'symbol']],
      ['.file&!doc', ['file']],
      ['id=f1', ['*']],
    ] as const
  ) assertEquals(asks(query), [...comps], query)
})
