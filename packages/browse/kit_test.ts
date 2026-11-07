import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { h } from 'preact'
import { mount } from '@yaks/tui/testing'
import { composition, sheet } from '@yaks/ui'
import { type Store, viewAt } from '@yaks/native/remote'
import { carried, Kit } from './kit.ts'

// The packing list's own view, as its app serves it.
let packing = await Deno.readTextFile(
  new URL('../../apps/packing/view.ts', import.meta.url),
)
let VIEW = 'https://yourname.yaks.app/packing/view.ts'

// A store in memory, and every batch written to it.
let kept = () => {
  let rows: Record<string, Record<string, unknown>> = {}
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
