// The public Entity door mounted through Preact: data and address changes must
// repaint, while each mounted entity owns exactly its own subscription.

import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { useLayoutEffect, useState } from 'preact/hooks'
import { type Bundle, define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import {
  type ComponentRenderer,
  entity,
  render,
  type Subscribe,
} from './mod.ts'
import { flush, mount } from './harness.ts'

let vocab = loadVocab([{
  $defs: { doc: { type: 'object', properties: { title: { type: 'string' } } } },
}])
let title = (b: Bundle) => String((b.doc as { title: string }).title)
let registry = define([
  {
    view: 'Tile',
    match: parse('.doc'),
    render: (b, h, ctx) => h('h2', null, title(b), String(ctx.suffix ?? '')),
  },
  {
    view: 'Inline',
    match: parse('.doc'),
    render: (b, h) => h('em', null, title(b)),
  },
  {
    view: 'Edit',
    match: parse('.column.type=string'),
    render: (b, h, ctx) =>
      h('input', {
        value: (b[ctx.comp!] as Record<string, unknown>)[ctx.col!],
      }),
  },
])
let bundle = (eid: string, text = eid): Bundle => ({
  entity: { eid },
  doc: { title: text },
})

let source = () => {
  let rows = new Map<string, Bundle>([['a', bundle('a')], ['b', bundle('b')]])
  let listeners = new Map<string, Set<() => void>>()
  let subscribe: Subscribe = (eid, notify) => {
    let set = listeners.get(eid) ?? new Set()
    listeners.set(eid, set)
    set.add(notify)
    return () => {
      set.delete(notify)
    }
  }
  let notify = (eid: string) => listeners.get(eid)?.forEach((fn) => fn())
  let count = (eid: string) => listeners.get(eid)?.size ?? 0
  return {
    rows,
    subscribe,
    notify,
    count,
    store: (eid: string) => rows.get(eid),
  }
}

Deno.test('Entity mounts the selected view and passes context, including columns', () => {
  let Entity = entity({ registry, vocab, store: () => bundle('a', 'A page') })
  let m = mount(h(Entity, { eid: 'a', view: 'Board.Tile', suffix: '!' }))
  try {
    assertEquals(m.root.innerHTML, '<h2>A page!</h2>')
    m.update(h(Entity, { eid: 'a', view: 'Inline' }))
    assertEquals(m.root.innerHTML, '<em>A page</em>')
    m.update(h(Entity, { eid: 'a', view: 'Edit', comp: 'doc', col: 'title' }))
    assertEquals(m.root.querySelector('input')?.value, 'A page')
    m.update(h(Entity, { eid: 'a', view: 'Unknown' }))
    assertEquals(m.root.innerHTML, '')
  } finally {
    m.free()
  }
})

Deno.test('notifications repaint replaced and in-place bundles, then release on unmount', async () => {
  let s = source()
  let Entity = entity({ registry, vocab, ...s })
  let m = mount(h(Entity, { eid: 'a', view: 'Tile' }))
  try {
    await flush()
    assertEquals(s.count('a'), 1)
    s.rows.set('a', bundle('a', 'Changed'))
    s.notify('a')
    await flush()
    assertEquals(m.root.textContent, 'Changed')
    ;(s.rows.get('a')!.doc as Record<string, unknown>).title = 'Again'
    s.notify('a')
    await flush()
    assertEquals(m.root.textContent, 'Again')
  } finally {
    m.free()
  }
  assertEquals(s.count('a'), 0)
})

Deno.test('changing eid removes the old listener; shared readers keep their own', async () => {
  let s = source()
  let Entity = entity({ registry, vocab, ...s })
  let m = mount(
    h(
      'div',
      null,
      h(Entity, { eid: 'a', view: 'Tile' }),
      h(Entity, { eid: 'a', view: 'Inline' }),
    ),
  )
  try {
    await flush()
    assertEquals(s.count('a'), 2)
    m.update(
      h(
        'div',
        null,
        h(Entity, { eid: 'b', view: 'Tile' }),
        h(Entity, { eid: 'a', view: 'Inline' }),
      ),
    )
    await flush()
    assertEquals([s.count('a'), s.count('b')], [1, 1])
    assertEquals(m.root.innerHTML, '<div><h2>b</h2><em>a</em></div>')
    s.rows.set('a', bundle('a', 'Old'))
    s.notify('a')
    await flush()
    assertEquals(m.root.innerHTML, '<div><h2>b</h2><em>Old</em></div>')
  } finally {
    m.free()
  }
  assertEquals([s.count('a'), s.count('b')], [0, 0])
})

Deno.test('a missing bundle can arrive and disappear through the same subscription', async () => {
  let s = source()
  let Entity = entity({ registry, vocab, ...s })
  let m = mount(h(Entity, { eid: 'later', view: 'Tile' }))
  try {
    await flush()
    assertEquals(m.root.innerHTML, '')
    s.rows.set('later', bundle('later'))
    s.notify('later')
    await flush()
    assertEquals(m.root.innerHTML, '<h2>later</h2>')
    s.rows.delete('later')
    s.notify('later')
    await flush()
    assertEquals(m.root.innerHTML, '')
  } finally {
    m.free()
  }
})

Deno.test('a change during subscription is not lost before the listener is ready', async () => {
  let row = bundle('a', 'Before')
  let Entity = entity({
    registry,
    vocab,
    store: () => row,
    subscribe: () => {
      ;(row.doc as Record<string, unknown>).title = 'During subscribe'
      return () => {}
    },
  })
  let m = mount(h(Entity, { eid: 'a', view: 'Tile' }))
  try {
    await flush()
    assertEquals(m.root.textContent, 'During subscribe')
  } finally {
    m.free()
  }
})

Deno.test('direct rendering produces nodes through the same hyperscript', () => {
  let m = mount(render(registry, bundle('a'), 'Tile', vocab))
  try {
    assertEquals(m.root.innerHTML, '<h2>a</h2>')
  } finally {
    m.free()
  }
})

Deno.test('native views own hook state and cleanup across view changes', async () => {
  let cleaned: string[] = []
  let face = (view: string): ComponentRenderer => ({
    view,
    match: true,
    Render: ({ e, suffix }) => {
      let [count, set] = useState(0)
      useLayoutEffect(() => () => {
        cleaned.push(view)
      }, [])
      return h(
        'button',
        { onClick: () => set(count + 1) },
        `${view}:${e.entity.eid}:${count}${suffix}`,
      )
    },
  })
  let registry = define([face('Tile'), face('Full')])
  let Entity = entity({ registry, vocab, store: () => bundle('a') })
  let mounted = mount(h(Entity, { eid: 'a', view: 'Tile', suffix: '!' }))
  try {
    assertEquals(mounted.root.textContent, 'Tile:a:0!')
    mounted.root.querySelector('button')!.click()
    await flush()
    assertEquals(mounted.root.textContent, 'Tile:a:1!')
    mounted.update(h(Entity, { eid: 'a', view: 'Tile', suffix: '?' }))
    assertEquals(mounted.root.textContent, 'Tile:a:1?')
    mounted.update(h(Entity, { eid: 'a', view: 'Full', suffix: '!' }))
    assertEquals(mounted.root.textContent, 'Full:a:0!')
    assertEquals(cleaned, ['Tile'])
  } finally {
    mounted.free()
  }
  assertEquals(cleaned, ['Tile', 'Full'])
})

Deno.test('native props preserve the application entity beside a matchable bundle', () => {
  type Ent = { eid: string; kids: string[] }
  let e: Ent = { eid: 'a', kids: ['b'] }
  let registry = define<ComponentRenderer<Ent>>([{
    view: 'Tile',
    match: parse('.doc'),
    Render: ({ e: original, suffix }) => {
      assertEquals(original === e, true)
      return h('p', null, original.kids.join(','), String(suffix))
    },
  }])
  let mounted = mount(
    render(registry, bundle('a'), 'Tile', vocab, {}, { e, suffix: '!' }),
  )
  try {
    assertEquals(mounted.root.innerHTML, '<p>b!</p>')
  } finally {
    mounted.free()
  }
})
