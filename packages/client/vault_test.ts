/// <reference lib="deno.ns" />
// The vault, across a reload: what a component declares `sync: none` and keeps
// is written through and comes back, what it declares `none` does not, and
// what the server owns was never this vault's business.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { area, boxClient, comp, fakeDb, fakeIdb } from './testing.ts'
import { stash, type Vault } from './vault.ts'
import { webStorage } from './web-storage.ts'

// One page load, then the next, over the same vault.
let reload = async (vault: Vault) => {
  let first = boxClient(undefined, { vault })
  await first.ready
  await first.mutate([{
    entity: { eid: 'r1' },
    doc: { title: 'Dal' },
    recipe: { serves: 4, course: 'dinner' },
    draft: { text: 'more cumin?' },
    sieve: { text: 'cum' },
  }])
  first.close()

  let next = boxClient(undefined, { vault })
  await next.ready
  return next
}

test('a local comp survives a rebuild; a none comp does not', async () => {
  let next = await reload(stash())
  assertEquals(comp(next.ent('r1'), 'draft').text, 'more cumin?')
  assertEquals(comp(next.ent('r1'), 'sieve'), {})
  // The wire tier is the server's to send back, not this vault's to keep.
  assertEquals(comp(next.ent('r1'), 'doc'), {})
  next.close()
})

test('the same, kept in IndexedDB', async () => {
  let next = await reload(fakeIdb(fakeDb()))
  assertEquals(comp(next.ent('r1'), 'draft').text, 'more cumin?')
  assertEquals(comp(next.ent('r1'), 'sieve'), {})
  next.close()
})

test('a rebuild keeps the number the entity had', async () => {
  let vault = stash()
  let first = boxClient(undefined, { vault })
  await first.ready
  // The number is the server's to give; here it arrives on the patch itself.
  await first.mutate([{ entity: { eid: 'r1', num: 7 }, draft: { text: 'x' } }])
  first.close()
  let next = boxClient(undefined, { vault })
  await next.ready
  assertEquals(next.ent('r1')?.entity.num, 7)
  next.close()
})

test('a watch sees the local tier arrive at boot', async () => {
  let db = fakeDb()
  let done = await reload(fakeIdb(db))
  done.close()

  let c = boxClient(undefined, { vault: fakeIdb(db) })
  let drafts = c.watch('.draft.text~=cumin')
  assertEquals(drafts.value, []) // nothing yet: a vault is asynchronous
  await c.ready
  assertEquals(drafts.value.map((b) => b.entity.eid), ['r1'])
  c.close()
})

test('a dropped comp is written through', async () => {
  let vault = stash()
  let c = boxClient(undefined, { vault })
  await c.mutate([{ entity: { eid: 'r1' }, draft: { text: 'more cumin?' } }])
  await c.mutate([{ entity: { eid: 'r1' }, draft: null }])
  assertEquals(await vault.load(), [])
  c.close()
})

test('a dead entity leaves the vault', async () => {
  let vault = stash()
  let c = boxClient(undefined, { vault })
  await c.mutate([{ entity: { eid: 'r1' }, draft: { text: 'more cumin?' } }])
  await c.mutate([{ entity: { eid: 'r1' }, $delete: true }])
  assertEquals(await vault.load(), [])
  c.close()
})

test('a wire-only write never touches the vault', async () => {
  let vault = stash()
  let touched = 0
  let counted: Vault = {
    ...vault,
    save: (recs) => {
      touched++
      return vault.save(recs)
    },
  }
  let c = boxClient(undefined, { vault: counted })
  await c.mutate([{ entity: { eid: 'r1' }, doc: { title: 'Dal' } }])
  assertEquals(touched, 0)
  c.close()
})

test('a tab component is back at once after a reload, and gone in a new tab', () => {
  let tab = area()
  let first = boxClient(undefined, { tab: webStorage(tab) })
  first.mutate([{
    entity: { eid: 'r1' },
    jotting: { text: 'more cumin?' },
    sieve: { text: 'cum' },
  }])
  first.close()

  let next = boxClient(undefined, { tab: webStorage(tab) })
  assertEquals(comp(next.ent('r1'), 'jotting').text, 'more cumin?')
  assertEquals(comp(next.ent('r1'), 'sieve'), {})
  next.close()
  let fresh = boxClient(undefined, { tab: webStorage(area()) })
  assertEquals(fresh.ent('r1'), undefined)
  fresh.close()
})

test('text sent from the box leaves nothing in the tab', () => {
  let tab = area()
  let c = boxClient(undefined, { tab: webStorage(tab) })
  c.mutate([{ entity: { eid: 'r1' }, jotting: { text: 'more cumin?' } }])
  c.mutate([{ entity: { eid: 'r1' }, jotting: null, doc: { title: 'Dal' } }])
  assertEquals(tab.length, 0)
  c.close()
})

test('a tab keeps only what this vocabulary keeps there', () => {
  let tab = area()
  tab.setItem('yaks:a', JSON.stringify({ eid: 'a', comps: { draft: {} } }))
  tab.setItem('yaks:b', 'not a record')
  tab.setItem('other:c', JSON.stringify({ eid: 'c', comps: { jotting: {} } }))
  let c = boxClient(undefined, { tab: webStorage(tab) })
  assertEquals(['a', 'b', 'c'].map(c.ent), [undefined, undefined, undefined])
  c.close()
})
