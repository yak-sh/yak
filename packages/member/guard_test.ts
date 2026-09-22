// The write side: what actually lands, through a guarded `apply()`.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Storage } from '@yaks/graph'
import { isPromise } from '@yaks/graph'
import { Denied } from './deny.ts'
import type { Floors } from './guard.ts'
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

// ---- an open thing: new rows, and your own ---------------------------------

// One change by one principal, as the guarded graph takes it.
let as = (s: Storage, who: string | null, b: Bundle, floors?: Floors) =>
  sync(
    guarded(s, ids.list, floors).apply([
      { ...b, ...(who ? { $actor: { by: who } } : {}) },
    ]),
  )

let opened = () => {
  let s = store()
  setMode(s, ids.list, 'open')
  as(s, ids.dana, { entity: { eid: 'mine' }, pick: { title: 'Dana’s' } })
  return s
}

let titleOf = (s: Storage, eid: string) =>
  ((s.read(`.eid=${eid}`) as Bundle[])[0]?.pick as { title?: string })?.title

Deno.test('a visitor adds to an open thing and changes nobody else’s row', () => {
  let s = opened()
  for (let who of [null, ids.kim, ids.mo]) {
    denied(() => as(s, who, { entity: { eid: 'mine' }, pick: { title: 'x' } }))
    denied(() => as(s, who, { entity: { eid: 'mine' }, pick: null }))
    denied(() => as(s, who, { entity: { eid: 'mine' }, $delete: true }))
  }
  assertEquals(titleOf(s, 'mine'), 'Dana’s')
  as(s, null, { entity: { eid: 'theirs' }, pick: { title: 'Hi' } })
  assertEquals(titleOf(s, 'theirs'), 'Hi')
})

Deno.test('a signed-in visitor changes and deletes what they wrote', () => {
  let s = opened()
  as(s, ids.kim, { entity: { eid: 'kims' }, pick: { title: 'One' } })
  as(s, ids.kim, { entity: { eid: 'kims' }, pick: { title: 'Two' } })
  assertEquals(titleOf(s, 'kims'), 'Two')
  denied(() => as(s, null, { entity: { eid: 'kims' }, $delete: true }))
  as(s, ids.kim, { entity: { eid: 'kims' }, $delete: true })
  assertEquals(titleOf(s, 'kims'), undefined)
})

Deno.test('an anonymous row is nobody’s, and saying it again is no change', () => {
  let s = opened()
  as(s, null, { entity: { eid: 'anon' }, pick: { title: 'Hi' } })
  as(s, null, { entity: { eid: 'anon' }, pick: { title: 'Hi' } })
  denied(() => as(s, null, { entity: { eid: 'anon' }, pick: { title: 'Yo' } }))
})

Deno.test('an editor changes anyone’s row on an open thing', () => {
  let s = opened()
  as(s, ids.raj, { entity: { eid: 'mine' }, pick: { title: 'Raj’s' } })
  assertEquals(titleOf(s, 'mine'), 'Raj’s')
})

Deno.test('a floor holds whatever the mode', () => {
  let s = opened()
  let row = { entity: { eid: 'p' }, pick: { title: 'priced' } }
  let floors: Floors = { pick: 'editor' }
  denied(() => as(s, null, row, floors))
  denied(() => as(s, ids.mo, row, floors))
  as(s, ids.raj, row, floors)
  let e = assertThrows(() =>
    as(s, ids.raj, { ...row, pick: { title: 'x' } }, { pick: 'owner' })
  ) as Denied
  assertEquals(e.need, 'owner')
})
