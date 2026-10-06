import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph, Refused } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { fn, val } from '@yaks/sql'
import { storage } from './mod.ts'
import { open } from './db.ts'
import { Denied, members } from '@yaks/member'
import { club } from '../member/testing.ts'
import { grant, ids, setMode } from '../member/testing.ts'
import { mem } from './testing.ts'

let vocab = loadVocab([{
  $defs: {
    player: {
      component: true,
      type: 'object',
      properties: { active: { type: 'boolean' } },
    },
    position: {
      component: true,
      type: 'object',
      sync: 'peers',
      properties: { x: { type: 'number' } },
    },
  },
}])
let fixture = (d = mem()) => {
  let s = storage(d, vocab)
  s.install()
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'hero' }, player: { active: true } }])
  )
  let query = d.query, calls = 0
  d.query = (stmt) => {
    calls++
    return query(stmt)
  }
  let get = () => s.tx((tx) => tx.get(['hero']), { admission: true })[0]
  return {
    d,
    s,
    get,
    calls: () => calls,
    reset: () => {
      calls = 0
    },
  }
}

test('certified admission reuses bounded authoritative reads and returns deep copies', () => {
  let f = fixture(), first = f.get()
  assertEquals(first.player, { active: true })
  f.reset()
  for (let i = 0; i < 10; i++) {
    let b = f.get()
    ;(b.player as { active: boolean }).active = false
  }
  // Only transaction boundaries, no SQL get or catalog validation.
  assertEquals(f.calls(), 20)
  assertEquals(f.get().player, { active: true })
})

test('admission snapshot follows durable changes, temporary rows and rollback', () => {
  let f = fixture()
  f.get()
  assertThrows(() =>
    f.s.tx((tx) => {
      tx.patch([{ entity: { eid: 'hero' }, player: { active: false } }])
      assertEquals(f.get().player, { active: false })
      throw new Error('rollback')
    })
  )
  assertEquals(f.get().player, { active: true })
  f.s.tx((tx) =>
    tx.patch([{ entity: { eid: 'hero' }, player: { active: false } }])
  )
  assertEquals(f.get().player, { active: false })
  f.d.query({
    t: 'alter table',
    table: 'player',
    add: { name: 'name', type: 'text' },
  })
  f.reset()
  f.get()
  assert(f.calls() > 2)
})

test('cached admission reads never cache standing or rules', () => {
  let f = fixture(), standing = true, checked = 0
  let g = graph({
    vocab,
    storage: f.s,
    plugins: [{
      name: 'authority',
      admission: () => true,
      hooks: {
        precondition: (bundles) => {
          checked++
          if (!standing) throw new Refused('revoked')
          return bundles
        },
      },
    }],
  })
  g.admit([{ entity: { eid: 'hero' }, position: { x: 1 } }])
  g.admit([{ entity: { eid: 'hero' }, position: { x: 2 } }])
  standing = false
  assertThrows(
    () => g.admit([{ entity: { eid: 'hero' }, position: { x: 3 } }]),
    Refused,
    'revoked',
  )
  assertEquals(checked, 3)
  assertEquals((g.get(['hero']) as Bundle[])[0].position, undefined)
})

test('admission snapshots observe another file connection commit', () => {
  let dir = Deno.makeTempDir({ prefix: 'T-65691-memo-' })
  let a = open(`${dir}/test.db`), b = open(`${dir}/test.db`)
  try {
    let f = fixture(a)
    assertEquals(f.get().player, { active: true })
    b.query({ t: 'update', table: 'player', set: { active: val(false) } })
    assertEquals(f.get().player, { active: false })
  } finally {
    a.close()
    b.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

test('admission memo refreshes dynamic components without rereading static state', () => {
  let d = mem()
  let s = storage(d, vocab, {
    derived: { 'position.x': { tag: 'number', expr: () => fn('random') } },
  })
  s.install()
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'hero' },
      player: { active: true },
      position: { x: 0 },
    }])
  )
  let get = () => s.tx((tx) => tx.get(['hero']), { admission: true })[0]
  let first = get().position as { x: number }
  let second = get().position as { x: number }
  assert(first.x != second.x)
  assertEquals(get().player, { active: true })
})

test('real member standing and stored revocations govern every memoized admission', () => {
  let s = storage(mem(), club)
  s.install()
  setMode(s, ids.notes, 'private')
  s.tx((tx) =>
    tx.patch([{ entity: { eid: ids.kim }, person: { name: 'Kim' } }])
  )
  let level: 'editor' | null | undefined = 'editor'
  let g = graph({
    storage: s,
    vocab: club,
    plugins: [members({
      app: ids.notes,
      space: ids.club,
      vocab: club,
      level: () => level,
    })],
  })
  let b = {
    entity: { eid: 'vouched' },
    pick: { title: 'Piranesi' },
    $actor: { by: ids.kim },
  }
  g.admit([b])
  g.admit([b])
  g.apply([b])
  level = null
  assertThrows(() => g.admit([b]), Denied)
  grant(s, 'standing', { app: ids.notes, person: ids.kim, access: 'editor' })
  level = undefined
  g.admit([b])
  g.admit([b])
  s.tx((tx) => tx.remove([{ eid: 'standing' }]))
  assertThrows(() => g.admit([b]), Denied)
})

test('raw SQL on the owning driver invalidates warmed admission values', () => {
  let f = fixture()
  assertEquals(f.get().player, { active: true })
  f.d.query({ t: 'update', table: 'player', set: { active: val(false) } })
  assertEquals(f.get().player, { active: false })
})

test('dynamic component appearance and disappearance invalidate whole admission snapshots', () => {
  let d = mem()
  let s = storage(d, vocab, {
    derived: { 'position.x': { tag: 'number', expr: () => val(5) } },
  })
  s.install()
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'hero' }, player: { active: true } }])
  )
  let get = () => s.tx((tx) => tx.get(['hero']), { admission: true })[0]
  assertEquals(get().position, undefined)
  s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 1 } }]))
  assertEquals(get().position, { x: 5 })
  s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: null }]))
  assertEquals(get().position, undefined)
})
