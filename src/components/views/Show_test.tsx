// The full document face's section renderers — especially the meta line,
// where an absent field must paint nothing.
import { type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { cache, ent } from '../../live.ts'
import { resolve } from '../registry.ts'
import '../Entity.tsx'

let raw = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .flat()

Deno.test('document meta paints no tally when it has no comments', () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Quiet document', body: '' },
    },
  }

  let e = ent('doc')
  let meta = resolve(e, 'Meta').Render({ e, id: true })!
  assertEquals(raw(meta).filter((c) => typeof c == 'number'), [])
})
