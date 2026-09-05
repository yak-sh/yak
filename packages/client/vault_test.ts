/// <reference lib="deno.ns" />
// The local tier, across a reload: what a component declares `persist: local`
// is written through and comes back, what it declares `none` does not, and
// what the server owns was never this vault's business.

import { assertEquals } from '@std/assert'
import { boxClient, comp, fakeDb, fakeIdb } from './harness.ts'
import { stash, type Vault } from './vault.ts'

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

Deno.test('a local comp survives a rebuild; a none comp does not', async () => {
  let next = await reload(stash())
  assertEquals(comp(next.ent('r1'), 'draft').text, 'more cumin?')
  assertEquals(comp(next.ent('r1'), 'sieve'), {})
  // The wire tier is the server's to send back, not this vault's to keep.
  assertEquals(comp(next.ent('r1'), 'doc'), {})
  next.close()
})

Deno.test('the same, kept in IndexedDB', async () => {
  let next = await reload(fakeIdb(fakeDb()))
  assertEquals(comp(next.ent('r1'), 'draft').text, 'more cumin?')
  assertEquals(comp(next.ent('r1'), 'sieve'), {})
  next.close()
})

Deno.test('a rebuild keeps the number the entity had', async () => {
  let next = await reload(stash())
  assertEquals(next.ent('r1')?.entity.num, 1)
  next.close()
})

Deno.test('a watch sees the local tier arrive at boot', async () => {
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

Deno.test('a dropped comp is written through', async () => {
  let vault = stash()
  let c = boxClient(undefined, { vault })
  await c.mutate([{ entity: { eid: 'r1' }, draft: { text: 'more cumin?' } }])
  await c.mutate([{ entity: { eid: 'r1' }, draft: null }])
  assertEquals(await vault.load(), [])
  c.close()
})

Deno.test('a dead entity leaves the vault', async () => {
  let vault = stash()
  let c = boxClient(undefined, { vault })
  await c.mutate([{ entity: { eid: 'r1' }, draft: { text: 'more cumin?' } }])
  await c.mutate([{ entity: { eid: 'r1' }, $delete: true }])
  assertEquals(await vault.load(), [])
  c.close()
})

Deno.test('a wire-only write never touches the vault', async () => {
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
