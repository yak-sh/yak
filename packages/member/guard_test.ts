// The write side: what actually lands, through a guarded `apply()`.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Storage } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { Denied } from './deny.ts'
import { grant, guarded, ids, setMode, store } from './harness.ts'

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  assert(!isPromise(out), 'apply() went async over a Map')
  return out
}

// One person writing one pick to one thing. `null` is nobody at all.
let writing = (
  s: Storage,
  app: string,
  who: string | null,
  eid = 'pick1',
) =>
  sync(
    guarded(s, app).apply([{
      entity: { eid },
      pick: { title: 'Piranesi' },
      ...(who ? { $actor: { by: who } } : {}),
    }]),
  )

let denied = (fn: () => unknown) => assertThrows(fn, Denied)

Deno.test('an owner writes', () => {
  let s = store()
  writing(s, ids.list, ids.dana)
  assertEquals((s.read('.pick!') as Bundle[]).length, 1)
})

Deno.test('an editor writes, a viewer does not', () => {
  let s = store()
  writing(s, ids.list, ids.raj)
  denied(() => writing(s, ids.list, ids.mo, 'pick2'))
})

Deno.test('a stranger is refused on a private thing', () => {
  let s = store()
  setMode(s, ids.list, 'private')
  denied(() => writing(s, ids.list, ids.kim))
  assertEquals((s.read('.pick!') as Bundle[]).length, 0)
})

Deno.test('a stranger is refused on a public thing too — public is a read', () => {
  let s = store()
  setMode(s, ids.list, 'public')
  denied(() => writing(s, ids.list, ids.kim))
})

Deno.test('anyone writes an open thing, as an anonymous actor', () => {
  let s = store()
  setMode(s, ids.list, 'open')
  writing(s, ids.list, ids.kim, 'pick1')
  writing(s, ids.list, null, 'pick2')
  assertEquals((s.read('.pick!') as Bundle[]).length, 2)
})

Deno.test('a grant admits a non-member to write', () => {
  let s = store()
  setMode(s, ids.notes, 'private')
  denied(() => writing(s, ids.notes, ids.kim))
  grant(s, 'g3', { app: ids.notes, person: ids.kim, access: 'editor' })
  writing(s, ids.notes, ids.kim, 'pick2')
  assertEquals((s.read('.pick!') as Bundle[]).length, 1)
})

Deno.test('a share link’s bearer writes when the link says editor', () => {
  let s = store()
  setMode(s, ids.notes, 'private')
  grant(s, 'share', { app: ids.notes, token: 'x7v2', access: 'editor' })
  writing(s, ids.notes, 'share')
  assertEquals((s.read('.pick!') as Bundle[]).length, 1)
})

Deno.test('the refusal names who, what, and what would have been enough', () => {
  let s = store()
  let e = assertThrows(() => writing(s, ids.list, ids.mo)) as Denied
  assertEquals(e.name, 'Denied')
  assertEquals(e.actor, ids.mo)
  assertEquals(e.app, ids.list)
  assertEquals(e.need, 'editor')
})

Deno.test('a refused batch lands nothing at all', () => {
  let s = store()
  denied(() =>
    sync(
      guarded(s, ids.list).apply([
        {
          entity: { eid: 'p1' },
          pick: { title: 'One' },
          $actor: { by: ids.mo },
        },
        {
          entity: { eid: 'p2' },
          pick: { title: 'Two' },
          $actor: { by: ids.mo },
        },
      ]),
    )
  )
  assertEquals((s.read('.pick!') as Bundle[]).length, 0)
})

Deno.test('only an owner writes the roster', () => {
  let s = store()
  let seat = (who: string) =>
    sync(
      guarded(s, ids.list).apply([{
        entity: { eid: 'seat4' },
        member: { space: ids.club, person: ids.kim },
        $actor: { by: who },
      }]),
    )
  // Raj may edit the list; he may not hand out keys.
  denied(() => seat(ids.raj))
  seat(ids.dana)
  assertEquals((s.read('.member!') as Bundle[]).length, 4)
})

Deno.test('an open thing does not open its own roster', () => {
  let s = store()
  setMode(s, ids.list, 'open')
  // Kim may write picks all day, and may not make herself an owner.
  writing(s, ids.list, ids.kim)
  denied(() =>
    sync(
      guarded(s, ids.list).apply([{
        entity: { eid: 'g9' },
        grant: { app: ids.list, person: ids.kim, access: 'owner' },
        $actor: { by: ids.kim },
      }]),
    )
  )
})

Deno.test('an owner may change what the thing says about everyone else', () => {
  let s = store()
  sync(
    guarded(s, ids.list).apply([{
      entity: { eid: ids.list },
      access: { mode: 'private' },
      $actor: { by: ids.dana },
    }]),
  )
  denied(() => writing(s, ids.list, ids.kim))
})

Deno.test('an empty batch is nobody’s business', () => {
  let s = store()
  assertEquals(sync(guarded(s, ids.list).apply([])), [])
})
