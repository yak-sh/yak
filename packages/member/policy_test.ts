// The read side: what each mode says to an owner, a granted member, a member
// with nothing, and a stranger.

import { assertEquals } from '@std/assert'
import type { Storage } from '@yaks/graph'
import { policy } from './policy.ts'
import { grant, ids, setMode, store } from './harness.ts'

let may = (s: Storage) => policy(s, { space: ids.club })

// Everyone, against one thing in one mode — the whole table in one line.
let reads = (s: Storage, app: string) =>
  Object.fromEntries(
    (['dana', 'raj', 'mo', 'kim'] as const).map((
      who,
    ) => [who, may(s).canRead(ids[who], app)]),
  )

let writes = (s: Storage, app: string) =>
  Object.fromEntries(
    (['dana', 'raj', 'mo', 'kim'] as const).map((
      who,
    ) => [who, may(s).canWrite(ids[who], app)]),
  )

Deno.test('a thing that never said is public', () => {
  let s = store()
  assertEquals(may(s).modeOf(ids.list), 'public')
})

Deno.test('public: anyone reads, only owner and editor write', () => {
  let s = store()
  setMode(s, ids.list, 'public')
  assertEquals(reads(s, ids.list), {
    dana: true,
    raj: true,
    mo: true,
    kim: true,
  })
  assertEquals(writes(s, ids.list), {
    dana: true,
    raj: true,
    mo: false,
    kim: false,
  })
})

Deno.test('open: anyone reads and anyone writes, nobody included', () => {
  let s = store()
  setMode(s, ids.list, 'open')
  assertEquals(reads(s, ids.list), {
    dana: true,
    raj: true,
    mo: true,
    kim: true,
  })
  assertEquals(writes(s, ids.list), {
    dana: true,
    raj: true,
    mo: true,
    kim: true,
  })
  assertEquals(may(s).canRead(null, ids.list), true)
  assertEquals(may(s).canWrite(null, ids.list), true)
})

Deno.test('private: only someone holding a level sees it at all', () => {
  let s = store()
  setMode(s, ids.list, 'private')
  // Mo is only a viewer — a viewer still READS a private thing.
  assertEquals(reads(s, ids.list), {
    dana: true,
    raj: true,
    mo: true,
    kim: false,
  })
  assertEquals(may(s).canRead(null, ids.list), false)
  assertEquals(writes(s, ids.list), {
    dana: true,
    raj: true,
    mo: false,
    kim: false,
  })
})

Deno.test('a member with no grant reaches a private thing like a stranger', () => {
  let s = store()
  setMode(s, ids.notes, 'private')
  // Nobody was granted the notes; only the club's owner gets in.
  assertEquals(reads(s, ids.notes), {
    dana: true,
    raj: false,
    mo: false,
    kim: false,
  })
})

Deno.test('the space owner is an implicit owner of everything in it', () => {
  let s = store()
  assertEquals(may(s).levelOf(ids.dana, ids.notes), 'owner')
  assertEquals(may(s).levelOf(ids.raj, ids.notes), null)
})

Deno.test('a grant admits a non-member', () => {
  let s = store()
  setMode(s, ids.notes, 'private')
  assertEquals(may(s).canRead(ids.kim, ids.notes), false)
  grant(s, 'g3', { app: ids.notes, person: ids.kim, access: 'editor' })
  assertEquals(may(s).levelOf(ids.kim, ids.notes), 'editor')
  assertEquals(may(s).canRead(ids.kim, ids.notes), true)
  assertEquals(may(s).canWrite(ids.kim, ids.notes), true)
})

Deno.test('a share link’s bearer acts as the grant they opened', () => {
  let s = store()
  setMode(s, ids.notes, 'private')
  grant(s, 'share', { app: ids.notes, token: 'x7v2', access: 'viewer' })
  // The door opened the token and signed the request as the grant itself.
  assertEquals(may(s).levelOf('share', ids.notes), 'viewer')
  assertEquals(may(s).canRead('share', ids.notes), true)
  assertEquals(may(s).canWrite('share', ids.notes), false)
  // and it is good for that thing only
  assertEquals(may(s).levelOf('share', ids.list), null)
})

Deno.test('without a space, only grants speak', () => {
  let s = store()
  let bare = policy(s)
  assertEquals(bare.levelOf(ids.dana, ids.notes), null)
  assertEquals(bare.levelOf(ids.raj, ids.list), 'editor')
})
