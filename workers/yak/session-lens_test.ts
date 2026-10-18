// The core transition keeps old pages and internal session readers on one eid.
import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { lenses } from '@yaks/lens'
import { loadVocab } from '@yaks/vocab'
import { appVocab } from './vocab.ts'
import {
  sessionMove,
  sessionPackage,
  sessionRows,
  sessionSource,
} from './session-lens.ts'
let vocab = loadVocab([...appVocab().docs, sessionSource])
let storage = ram(vocab)
let bare = graph({ vocab, storage })
bare.apply([{
  entity: { eid: 'source' },
  using: { instructions: 'base', tools: [] },
}])
let g = graph({
  vocab,
  storage,
  plugins: [
    lenses(undefined, {
      vocab,
      rows: sessionRows(),
      speaks: { [sessionPackage]: 0 },
    }),
  ],
})
g.apply([{
  entity: { eid: sessionPackage },
  _package: { name: '@yaks/session' },
}, ...sessionRows()], { trusted: true })
test('the core pending bridge exposes sending and no empty model choice on the same eid', () => {
  let [row] = g.get(['source']) as Bundle[]
  equal(row.entity.eid, 'source')
  equal(row.sending, { instructions: 'base', tools: [] })
  equal(row.using, undefined)
  let [stored] = bare.get(['source']) as Bundle[]
  equal(stored.using, { instructions: 'base', tools: [] })
})
test('the core mover consumes source-only selections without creating empty using', () => {
  let [row] = bare.get(['source']) as Bundle[]
  let [patch] = sessionMove().move(row)
  equal(patch.using, null)
  equal(patch.sending, { instructions: 'base', tools: [] })
})
let old = { [sessionPackage]: 0 }
g.apply([{
  entity: { eid: 'oldpage' },
  using: { effort: 'low', instructions: 'kept', tools: [] },
  $speaks: old,
}], { trusted: true })
test('a kept page writes old fields while a current consumer reads sending', () => {
  let [row] = g.get(['oldpage']) as Bundle[]
  equal(row.using, { effort: 'low' })
  equal(row.sending, { instructions: 'kept', tools: [] })
  let [kept] = g.get(['oldpage'], undefined, { speaks: old }) as Bundle[]
  equal((kept.using as Comp).instructions, 'kept')
})
