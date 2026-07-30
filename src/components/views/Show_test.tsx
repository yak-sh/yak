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

Deno.test('comment dependencies lead with the entity commented on', () => {
  cache.value = {
    comment: {
      entity: { eid: 'comment', num: 2 },
      doc: { eid: 'comment', title: '', body: 'A note' },
      comment: { eid: 'comment', target_eid: 'target' },
    },
    target: {
      entity: { eid: 'target', num: 1 },
      doc: { eid: 'target', title: 'The subject', body: '' },
    },
  }

  let e = ent('comment')
  let renderer = resolve(e, 'Dependencies')
  let target = raw(renderer.Render({ e })!)[0]
  assertEquals(target.props, {
    eid: 'target',
    view: 'Dependency',
    type: 'comment',
    label: 'on',
  })
})
