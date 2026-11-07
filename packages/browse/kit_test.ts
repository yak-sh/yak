import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { h } from 'preact'
import { mount } from '@yaks/tui/testing'
import { composition, sheet } from '@yaks/ui'
import { mount as native, type Node } from '@yaks/native'
import { type Store, viewAt } from '@yaks/native/remote'
import { carried, Kit } from './kit.ts'

// The packing list's own view, as its app serves it.
let packing = await Deno.readTextFile(
  new URL('../../apps/packing/view.ts', import.meta.url),
)
let VIEW = 'https://yourname.yaks.app/packing/view.ts'

// A store in memory, holding `rows`, and every batch written to it.
let kept = (rows: Record<string, Record<string, unknown>> = {}) => {
  let wrote: object[][] = []
  let store: Store = {
    query: <T>() => Promise.resolve(Object.values(rows) as T[]),
    apply: (bundles) => {
      wrote.push(bundles)
      for (let b of bundles as { entity: { eid: string } }[]) {
        let eid = b.entity.eid.replace('$', 'e')
        rows[eid] = { ...rows[eid], ...b, entity: { eid } }
      }
      return Promise.resolve({})
    },
  }
  return { store, wrote }
}

let settle = () => new Promise((r) => setTimeout(r, 5))
// Settle until `ok`: outside a browser Preact runs an effect up to a frame
// (35 ms) after the render that scheduled it.
let until = async (ok: () => boolean) => {
  for (let i = 0; i < 40 && !ok(); i++) await settle()
}

test('a kit-built app opens in the terminal over its own rows', async () => {
  let go = (() => Promise.resolve(new Response(packing))) as typeof fetch
  let view = await viewAt(VIEW, carried, go)
  let { store, wrote } = kept()
  let screen = await mount(
    () => h(Kit, { view, store }),
    50,
    14,
    sheet(composition),
  )
  await settle()
  assertStringIncludes(screen.text(), 'Nothing to bring yet')
  // The field holds the focus: what is typed goes in, Enter adds it.
  await screen.send('socks')
  await screen.send('\r')
  await settle()
  assertEquals((wrote[0][0] as { doc: unknown }).doc, { title: 'socks' })
  assertStringIncludes(screen.text(), '☐ socks')
  assertStringIncludes(screen.text(), '1 to pack')
  // Tab past Add to the item; Space packs it.
  await screen.send('\t')
  await screen.send('\t')
  await screen.send(' ')
  await settle()
  assertEquals(Object.keys(wrote[1][0]), ['entity', 'packed'])
  assertStringIncludes(screen.text(), '☑ socks')
  assertStringIncludes(screen.text(), '0 to pack')
  screen.free()
})

// The words a native paint shows, in reading order; a toggle reads as the
// terminal draws its box.
let shown = (n: Node | null): string[] =>
  !n
    ? []
    : n.kind == 'text'
    ? [n.runs.map((r) => typeof r == 'string' ? r : shown(r).join('')).join('')]
    : n.kind == 'box'
    ? n.children.flatMap(shown)
    : n.kind == 'toggle'
    ? [`${n.on ? '☑' : '☐'} ${n.label.join('')}`]
    : []

let toggles = (n: Node | null): Extract<Node, { kind: 'toggle' }>[] =>
  !n
    ? []
    : n.kind == 'toggle'
    ? [n]
    : n.kind == 'box'
    ? n.children.flatMap(toggles)
    : []

test('a kit-built app paints the same natively as in the terminal', async () => {
  let go = (() => Promise.resolve(new Response(packing))) as typeof fetch
  let view = await viewAt(VIEW, carried, go)
  let rows = () => ({
    e1: { entity: { eid: 'e1' }, doc: { title: 'socks' } },
    e2: {
      entity: { eid: 'e2' },
      doc: { title: 'tent' },
      packed: { at: '2026-11-07' },
    },
  })
  let screen = await mount(
    () => h(Kit, { view, store: kept(rows()).store }),
    50,
    14,
    sheet(composition),
  )
  await settle()
  let terminal = screen.text()
  screen.free()
  let { store, wrote } = kept(rows())
  let last: Node | null = null
  let free = native(
    h(view, { store }),
    { tags: {}, classes: {} },
    (n) => last = n,
  )
  await until(() => toggles(last).length > 0)
  let words = shown(last).filter((w) => w.trim())
  assertEquals(words.slice(0, 2), ['Packing list', '1 to pack'])
  assertEquals(words.filter((w) => /^[☐☑]/.test(w)), ['☐ socks', '☑ tent'])
  // Every word the phone shows, the terminal shows, in the same order.
  let at = 0
  for (let w of words) {
    let found = terminal.indexOf(w, at)
    assert(found >= 0, `the terminal does not show ${w} after ${at}`)
    at = found + w.length
  }
  // A toggle flipped on the phone writes what Space in the terminal does.
  toggles(last)[0].flip()
  await until(() => toggles(last)[0]?.on == true)
  assertEquals(Object.keys(wrote[0][0]), ['entity', 'packed'])
  assertEquals(shown(last).slice(0, 2), ['Packing list', '0 to pack'])
  free()
})
