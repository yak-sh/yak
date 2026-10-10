import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph, Refused } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype'
import { col, eq, fn, val } from '@yaks/sql'
import { storage } from './mod.ts'
import { open } from './db.ts'
import { Denied, members } from '@yaks/member'
import { club } from '../member/testing.ts'
import { grant, ids, setMode } from '../member/testing.ts'
import { mem } from './testing.ts'
import { get, read } from './read.ts'
import { basis } from './memo.ts'
import { parse } from '@yaks/query'

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
  let dir = Deno.makeTempDirSync({ prefix: 'T-65691-memo-' })
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

test('ordinary transactions reuse authoritative reads while pending component images bypass reuse', () => {
  let f = fixture()
  f.get()
  f.reset()
  assertEquals(f.s.tx((tx) => tx.get(['hero']))[0].player, { active: true })
  assertEquals(f.calls(), 2)
  f.s.tx((tx) => {
    tx.patch([{ entity: { eid: 'hero' }, position: { x: 3 } }])
    assertEquals(tx.get(['hero'])[0].position, { x: 3 })
    tx.patch([{ entity: { eid: 'hero' }, position: null }])
    assertEquals(tx.get(['hero'])[0].position, undefined)
  })
  assertEquals(f.get().position, undefined)
})

// Statements a read costs, transaction boundaries aside.
let reads = (f: ReturnType<typeof fixture>, read: () => unknown) => {
  let query = f.d.query, n = 0
  f.d.query = (stmt) => {
    if (!['savepoint', 'release', 'begin', 'commit'].includes(stmt.t)) n++
    return query(stmt)
  }
  try {
    read()
  } finally {
    f.d.query = query
  }
  return n
}

test('an entity is read once until a write names it, whoever else is written', () => {
  let f = fixture()
  f.s.tx((tx) =>
    tx.patch([{ entity: { eid: 'other' }, player: { active: false } }])
  )
  assertEquals(f.s.get(['hero'])[0].player, { active: true })
  assertEquals(reads(f, () => f.s.get(['hero'])), 0)
  assertEquals(reads(f, () => f.get()), 0)
  f.s.tx((tx) =>
    tx.patch([{ entity: { eid: 'other' }, player: { active: true } }])
  )
  assertEquals(reads(f, () => f.s.get(['hero'])), 0)
  f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 2 } }]))
  assertEquals(f.s.get(['hero'])[0].position, { x: 2 })
  f.s.tx((tx) => tx.remove([{ eid: 'hero' }]))
  assertEquals('tombstone' in f.s.get(['hero'])[0], true)
})

test('a rolled-back write is read again; what it never wrote stays held', () => {
  let f = fixture()
  f.s.tx((tx) =>
    tx.patch([{ entity: { eid: 'other' }, player: { active: false } }])
  )
  f.s.get(['hero', 'other'])
  assertThrows(() =>
    f.s.tx((tx) => {
      tx.patch([{ entity: { eid: 'hero' }, player: { active: false } }])
      assertEquals(tx.get(['hero'])[0].player, { active: false })
      assertEquals(f.s.get(['hero'])[0].player, { active: false })
      throw new Error('rollback')
    })
  )
  assertEquals(f.s.get(['hero'])[0].player, { active: true })
  assertEquals(reads(f, () => f.s.get(['other'])), 0)
  // A write it cannot name keeps nothing until its transaction ends.
  assertThrows(() =>
    f.s.tx(() => {
      f.d.query({ t: 'update', table: 'player', set: { active: val(true) } })
      assertEquals(f.s.get(['other'])[0].player, { active: true })
      throw new Error('rollback')
    })
  )
  assertEquals(f.s.get(['hero', 'other']).map((b) => b.player), [
    { active: true },
    { active: false },
  ])
})

test('a transaction that moved one entity still reads others from memory', () => {
  let d = mem(), s = storage(d, loadVocab([archetypeDoc, ...vocab.docs]))
  s.install()
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'hero' }, player: { active: true } }])
  )
  let f = { ...fixture(), d, s }
  f.s.get(['hero'])
  f.s.tx((tx) => {
    tx.patch([{ entity: { eid: 'fresh' }, player: { active: false } }])
    assertEquals(reads(f, () => tx.get(['hero'])), 0)
    assertEquals(tx.get(['fresh', 'hero']).map((b) => b.player), [
      { active: false },
      { active: true },
    ])
  })
})

test('a get naming components is cut from the whole entity held', () => {
  let f = fixture()
  f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 1 } }]))
  f.s.get(['hero', 'nobody'])
  assertEquals(reads(f, () => f.s.get(['hero', 'nobody'], ['position'])), 0)
  assertEquals(f.s.get(['hero', 'nobody'], ['position']), [{
    entity: { eid: 'hero' },
    position: { x: 1 },
  }])
  assertEquals(f.s.get(['hero'], []), [{ entity: { eid: 'hero' } }])
})

test('a get naming components keeps what it read for one naming no others', () => {
  let f = fixture()
  f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 1 } }]))
  // A store bound afresh has kept nothing of what was written.
  let s = storage(f.d, vocab)
  s.install()
  let g = { ...f, s }
  let hero = (comps?: string[]) => s.get(['hero'], comps)[0]
  assertEquals(hero(['position']), {
    entity: { eid: 'hero' },
    position: { x: 1 },
  })
  assertEquals(reads(g, () => hero(['position'])), 0)
  assertEquals(hero(['position']).position, { x: 1 })
  assertEquals(reads(g, () => hero([])), 0)
  assertEquals(hero([]), { entity: { eid: 'hero' } })
  // What it did not ask, or all there is, is read.
  assert(reads(g, () => hero(['player'])) > 0)
  assertEquals(hero(['player']).player, { active: true })
  assertEquals(hero(['position']).position, { x: 1 })
  assert(reads(g, () => hero()) > 0)
  assertEquals(hero(), {
    entity: { eid: 'hero' },
    player: { active: true },
    position: { x: 1 },
  })
  // A write names it.
  f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 2 } }]))
  assertEquals(hero(['position']).position, { x: 2 })
  f.s.tx((tx) => tx.remove([{ eid: 'hero' }]))
  assertEquals('tombstone' in hero(['position']), true)
})

test('text the blob table adds leaves what memory holds standing', () => {
  let f = fixture()
  f.d.query({
    t: 'create table',
    name: 'blob_text',
    cols: [
      { name: 'sha', type: 'text', pk: true },
      { name: 'value', type: 'text', notNull: true },
    ],
  })
  f.s.get(['hero'])
  f.d.query({
    t: 'insert',
    or: 'ignore',
    into: 'blob_text',
    cols: ['sha', 'value'],
    rows: [[val('a'), val('words')]],
  })
  assertEquals(reads(f, () => f.s.get(['hero'])), 0)
  // Text taken away may be text an entity reads.
  f.d.query({ t: 'delete', from: 'blob_text', where: eq(col('sha'), val('a')) })
  assert(reads(f, () => f.s.get(['hero'])) > 0)
})

let selects = (f: ReturnType<typeof fixture>, body: () => unknown) => {
  let query = f.d.query, n = 0
  f.d.query = (stmt) => {
    if (stmt.t == 'select') n++
    return query(stmt)
  }
  try {
    body()
  } finally {
    f.d.query = query
  }
  return n
}

test('a transaction asks about a spine once, however many patches name it', () => {
  let f = fixture()
  let write = () =>
    f.s.tx((tx) => {
      tx.patch([{ entity: { eid: 'mob' }, player: { active: true } }])
      tx.patch([{ entity: { eid: 'mob' }, position: { x: 1 } }])
      tx.patch([{ entity: { eid: 'mob' }, position: { x: 2 } }])
    })
  assertEquals(selects(f, write), 1)
  assertEquals(selects(f, write), 0)
  assertEquals(f.s.get(['mob'])[0].position, { x: 2 })
})

test('a removal lets go of the spines it buried, and of no other', () => {
  let f = fixture()
  let mob = (x: number) =>
    f.s.tx((tx) => tx.patch([{ entity: { eid: 'mob' }, position: { x } }]))
  mob(1)
  assertEquals(selects(f, () => mob(2)), 0)
  f.s.tx((tx) => tx.remove([{ eid: 'hero' }]))
  assertEquals(selects(f, () => mob(3)), 0)
  // The buried one's spine is read again, and says it is dead.
  assertEquals(
    selects(
      f,
      () =>
        f.s.tx((tx) =>
          tx.patch([{ entity: { eid: 'hero' }, player: { active: false } }])
        ),
    ),
    1,
  )
  assertEquals(f.s.get(['hero'])[0].player, undefined)
})

test('an answer stands through a removal of what it never selected', () => {
  let f = fixture()
  f.s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'mob' }, player: { active: true } },
      { entity: { eid: 'rock' }, position: { x: 1 } },
    ])
  )
  let active = () => f.s.rows('.player.active=true').map((r) => r.eid)
  let still = () => f.s.rows('!position').map((r) => r.eid)
  active(), active(), still(), still()
  f.s.tx((tx) => tx.remove([{ eid: 'rock' }]))
  assertEquals(reads(f, active), 0)
  f.s.tx((tx) => tx.remove([{ eid: 'mob' }]))
  assertEquals(active(), ['hero'])
  assertEquals(still(), ['hero'])
})

// A driver whose transactions are its own (a Durable Object's
// transactionSync), opened beside the statements the store sees.
let native = () => {
  let d = mem(), query = d.query.bind(d)
  d.tx = (body) => {
    query({ t: 'savepoint', name: 'native' })
    try {
      let out = body()
      query({ t: 'release', name: 'native' })
      return out
    } catch (e) {
      query({ t: 'rollback', to: 'native' })
      query({ t: 'release', name: 'native' })
      throw e
    }
  }
  return d
}

for (
  let [name, driver] of [['savepoints', mem], ['its own', native]] as const
) {
  test(`spines a rolled-back transaction minted or buried are let go, transactions ${name}`, () => {
    let f = fixture(driver())
    let mob = (comps: Omit<Bundle, 'entity'>) => [{
      entity: { eid: 'mob' },
      ...comps,
    }]
    let fail = (
      body: (tx: Parameters<Parameters<typeof f.s.tx>[0]>[0]) => void,
    ) =>
      assertThrows(() =>
        f.s.tx((tx) => {
          body(tx)
          throw new Error('no')
        })
      )
    fail((tx) => tx.patch(mob({ player: { active: true } })))
    f.s.tx((tx) => tx.patch(mob({ position: { x: 1 } })))
    assertEquals(f.s.get(['mob'])[0].position, { x: 1 })
    fail((tx) => {
      tx.remove([{ eid: 'mob' }])
      tx.patch(mob({ position: { x: 2 } }))
    })
    f.s.tx((tx) => tx.patch(mob({ position: { x: 3 } })))
    assertEquals(f.s.get(['mob'])[0].position, { x: 3 })
    // A buried entity takes no rows until it is brought back.
    f.s.tx((tx) => tx.remove([{ eid: 'mob' }]))
    f.s.tx((tx) => tx.patch(mob({ position: { x: 4 } })))
    f.s.tx((tx) => {
      tx.revive(['mob'])
      tx.patch(mob({ player: { active: false } }))
    })
    assertEquals(f.s.get(['mob'])[0].position, undefined)
  })
}

test('a query asked again is kept, and reads nothing until a table it stands on is written', () => {
  let f = fixture()
  let active = () => f.s.rows('.player.active=true').map((r) => r.eid)
  // Asked once, an answer is not kept: most queries are never asked again.
  assertEquals(reads(f, active), 1)
  assertEquals(reads(f, active), 1)
  assertEquals(reads(f, active), 0)
  f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 1 } }]))
  assertEquals(reads(f, active), 0)
  f.s.tx((tx) =>
    tx.patch([{ entity: { eid: 'mob' }, player: { active: true } }])
  )
  assertEquals(active(), ['hero', 'mob'])
  f.s.tx((tx) => tx.remove([{ eid: 'hero' }]))
  assertEquals(active(), ['mob'])
  assertEquals(
    f.s.tx((tx) => tx.read('.player.active=true')).map((b) => b.entity.eid),
    ['mob'],
  )
})

test('a read takes its entities from memory', () => {
  let f = fixture()
  let read = () => f.s.read('.player.active=true')
  read()
  read()
  assertEquals(reads(f, read), 0)
  f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 3 } }]))
  assertEquals(read()[0].position, { x: 3 })
  assertEquals(
    f.s.tx((tx) => tx.read('.player.active=true'))[0].position,
    { x: 3 },
  )
  assertEquals(
    reads(f, () => f.s.tx((tx) => tx.read('.player.active=true'))),
    0,
  )
})

test('an answer that requires no row takes in every new entity', () => {
  let f = fixture()
  let still = () => f.s.rows('!position').map((r) => r.eid)
  assertEquals(still(), ['hero'])
  f.s.tx((tx) =>
    tx.patch([{ entity: { eid: 'mob' }, player: { active: false } }])
  )
  assertEquals(still(), ['hero', 'mob'])
})

test('an answer kept inside a rolled-back transaction goes with it', () => {
  let f = fixture()
  let active = () => f.s.rows('.player.active=true').map((r) => r.eid)
  assertThrows(() =>
    f.s.tx((tx) => {
      tx.patch([{ entity: { eid: 'mob' }, player: { active: true } }])
      assertEquals(active(), ['hero', 'mob'])
      throw new Error('no')
    })
  )
  assertEquals(active(), ['hero'])
})

test('what memory cannot follow is read every time', () => {
  let player = parse('.player.active=true')
  assertEquals(basis(vocab, player)?.sort(), ['player', 'tombstone'])
  for (
    let q of [
      '.player.active=true hello',
      '.player.nope=1',
      '.position.x>today',
    ]
  ) assertEquals(basis(vocab, parse(q)), undefined, q)
})

test('a scan does not push out what is read again', () => {
  let f = fixture()
  f.s.get(['hero'])
  let many = Array.from({ length: 2100 }, (_, i) => `mob-${i}`)
  f.s.tx((tx) =>
    tx.patch(many.map((eid) => ({ entity: { eid }, position: { x: 1 } })))
  )
  assertEquals(f.s.get(many).length, 2100)
  assertEquals(reads(f, () => f.s.get(['hero'])), 0)
})

test('an entity a transaction patched is known without reading it back', () => {
  let f = fixture()
  f.s.get(['hero'])
  f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 2 } }]))
  f.s.tx((tx) =>
    tx.patch([{ entity: { eid: 'mob' }, player: { active: false } }])
  )
  assertEquals(
    reads(f, () =>
      assertEquals(f.s.get(['hero', 'mob']), [
        {
          entity: { eid: 'hero' },
          player: { active: true },
          position: { x: 2 },
        },
        { entity: { eid: 'mob' }, player: { active: false } },
      ])),
    0,
  )
})

// How many statements `body` writes to `table` through `d`.
let writes = (
  d: ReturnType<typeof mem>,
  table: string,
  body: () => unknown,
) => {
  let query = d.query, n = 0
  d.query = (stmt) => {
    if (
      stmt.t == 'insert' && stmt.into == table ||
      stmt.t == 'update' && stmt.table == table
    ) n++
    return query(stmt)
  }
  try {
    body()
  } finally {
    d.query = query
  }
  return n
}

test('a component an entity is known to lack is written in one statement', () => {
  let f = fixture()
  f.s.get(['hero'])
  let move = (x: number) =>
    f.s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x } }]))
  assertEquals(writes(f.d, 'position', () => move(1)), 1)
  assertEquals(writes(f.d, 'position', () => move(2)), 1)
  // What it is known to hold already is not written again.
  assertEquals(writes(f.d, 'position', () => move(2)), 0)
  assertEquals(f.s.get(['hero'])[0].position, { x: 2 })
})

test('drivers sharing a connection share what memory keeps of it', () => {
  let d = mem()
  let other = { ...d, connection: d }
  let s = storage(d, vocab), t = storage(other, vocab)
  s.install()
  s.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 1 } }]))
  assertEquals(s.get(['hero'])[0].position, { x: 1 })
  t.tx((tx) => tx.patch([{ entity: { eid: 'hero' }, position: { x: 2 } }]))
  assertEquals(s.get(['hero'])[0].position, { x: 2 })
  t.tx((tx) => tx.remove([{ eid: 'hero' }]))
  assertEquals('tombstone' in s.get(['hero'])[0], true)
})

test('a patch after another connection commits builds on what it committed', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'T-65275-memo-' })
  let a = open(`${dir}/test.db`), b = open(`${dir}/test.db`)
  try {
    let f = fixture(a)
    f.s.get(['hero'])
    b.query({ t: 'update', table: 'player', set: { active: val(false) } })
    f.s.tx((tx) => {
      tx.patch([{ entity: { eid: 'hero' }, position: { x: 1 } }])
      tx.get(['other'])
    })
    assertEquals(f.s.get(['hero']), get(a, vocab, ['hero']))
  } finally {
    a.close()
    b.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

// Every shape a property stores, with a default a new row takes.
let wide = loadVocab([{
  $defs: {
    kit: {
      component: true,
      type: 'object',
      properties: {
        name: { type: 'string' },
        n: { type: 'number' },
        whole: { type: 'integer' },
        on: { type: 'boolean' },
        data: { type: 'object' },
        list: { type: 'array' },
        tier: { type: 'string', enum: ['low', 'high'] },
        level: { type: 'integer', default: 3 },
        friend: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    tag: { component: true, type: 'object' },
  },
}])

test('a component whose values memory cannot say is still known to be held', () => {
  let d = mem(), s = storage(d, vocab)
  s.install()
  let moved = s.tx((tx) => {
    // A number into a boolean column is storage's to say.
    tx.patch([{ entity: { eid: 'a' }, player: { active: 1 } }])
    let move = () => tx.patch([{ entity: { eid: 'a' }, position: { x: 1 } }])
    return writes(d, 'position', move)
  })
  assertEquals(moved, 1)
  assertEquals(s.get(['a']), get(d, vocab, ['a']))
})

test('what memory says a patched entity holds, and what it answers, is what storage reads', () => {
  let d = mem(), s = storage(d, wide, { number: true })
  s.install()
  let eids = ['a', 'b', 'c', 'd'], all = eids
  let seed = 7
  let rand = (n: number) => (seed = (seed * 48271) % 2147483647) % n
  let pick = <T>(xs: T[]) => xs[rand(xs.length)]
  let values: Record<string, unknown[]> = {
    // A number into a text column, and text into a number one, are what
    // memory leaves storage to say.
    name: ['x', '', 'long name', 5, null],
    n: [0, 1.5, -2, 1e21, 0.1 + 0.2, '12', null],
    whole: [0, 7, -3, 2 ** 40, null],
    on: [true, false, null],
    data: [{ b: 1, a: [1, 2.5, { c: null }] }, {}, null],
    list: [[], [1, 'two', { three: 3 }], null],
    tier: ['low', 'high', null],
    level: [1, null],
    friend: ['a', 'b', 'z', null],
  }
  let bundle = (): Bundle => {
    let b: Bundle = { entity: { eid: pick(all) } }
    if (rand(4) == 0) b.kit = null
    else {
      let kit: Record<string, unknown> = {}
      for (let p of Object.keys(values)) {
        if (rand(3) == 0) kit[p] = pick(values[p])
      }
      b.kit = kit
    }
    if (rand(3) == 0) b.tag = rand(2) ? {} : null
    return b
  }
  // Queries memory keeps answers to across writes that move nothing they
  // select, and some it keeps only until their tables are written.
  let queries = [
    '.kit.name=x',
    '.kit.n>0',
    '.kit.on=true|.tag',
    '!tag',
    '.kit !kit.tier',
    '.kit.tier=low .order=-kit.n .limit=2',
    '.kit.whole=7 .fields=kit.n',
    '.kit.friend=a',
    '.kit.friend.kit.on=true',
  ]
  let eidsOf = (bs: Bundle[]) => bs.map((b) => b.entity.eid)
  for (let round = 0; round < 120; round++) {
    // Each round may also mint an entity storage has never held.
    all = [...eids, `new${round}`]
    s.get(all)
    for (let q of queries) s.read(q)
    let batch = Array.from({ length: 1 + rand(3) }, bundle)
    try {
      s.tx((tx) => {
        tx.patch(batch)
        if (rand(5) == 0) tx.patch([bundle()])
        if (rand(7) == 0) throw new Error('rolled back')
      })
    } catch (e) {
      if ((e as Error).message != 'rolled back') throw e
    }
    assertEquals(s.get(all), get(d, wide, all), `round ${round}`)
    for (let q of queries) {
      assertEquals(
        eidsOf(s.read(q)),
        eidsOf(read(d, wide, q)),
        `round ${round}: ${q}`,
      )
    }
  }
})

test('an answer stands through a write that moves nothing it selects', () => {
  let f = fixture()
  let ask = () => f.s.read('.player.active=true').map((b) => b.entity.eid)
  assertEquals(ask(), ['hero'])
  assertEquals(ask(), ['hero'])
  let player = (eid: string, active: boolean) =>
    f.s.tx((tx) => tx.patch([{ entity: { eid }, player: { active } }]))
  player('mob', false)
  assertEquals(reads(f, ask), 0)
  player('mob', true)
  assertEquals(ask(), ['hero', 'mob'])
  player('hero', false)
  assertEquals(ask(), ['mob'])
  // Another store's writes are its own to account for.
  let other = storage(f.d, vocab)
  other.tx((tx) =>
    tx.patch([{ entity: { eid: 'imp' }, player: { active: true } }])
  )
  assertEquals(ask(), ['mob', 'imp'])
})
