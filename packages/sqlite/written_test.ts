// What memory keeps of a file when another connection commits: the entities
// that connection wrote are read again, and nothing else.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { col, eq, select, sub, table, val } from '@yaks/sql'
import { storage } from './mod.ts'
import { open } from './db.ts'
import { get } from './read.ts'
import { memoized } from './memo.ts'
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
      properties: { x: { type: 'number' } },
    },
  },
}])

// Two connections to one file, `a` reading through memory and `b` writing
// raw statements, with the eids each of a's reads went to storage for.
let file = (unlogged: string[] = []) => {
  let path = `${Deno.makeTempDirSync()}/graph.db`
  let a = open(path), b = open(path)
  storage(a, vocab).install()
  for (let name of unlogged) {
    for (let event of ['insert', 'update', 'delete']) {
      a.query({ t: 'drop', kind: 'trigger', name: `written_${name}_${event}` })
    }
  }
  storage(b, vocab).tx((tx) =>
    tx.patch([
      { entity: { eid: 'hero' }, player: { active: true }, position: { x: 0 } },
      { entity: { eid: 'other' }, player: { active: true } },
    ])
  )
  let memo = memoized(a, vocab), asked: string[][] = []
  let read = (eids: string[]) => {
    asked.length = 0
    let found = memo.get((ids, comps) => {
      asked.push(ids)
      return get(a, vocab, ids, {}, comps)
    }, eids).map((b) => [b.player, b.position])
    return { found, asked: [...asked] }
  }
  // Every statement a case runs is prepared before it is timed.
  a.query({ t: 'begin' })
  a.query(set('position', 'hero', { x: 0 }))
  read(['hero', 'other'])
  a.query({ t: 'rollback' })
  read(['hero', 'other'])
  b.query(set('player', 'hero', { active: true }))
  read(['hero', 'other'])
  b.query(set('position', 'hero', { x: 0 }))
  read(['hero', 'other'])
  return { a, b, read }
}

// A statement setting `comp` of the entity `eid`.
let set = (
  comp: string,
  eid: string,
  values: Record<string, number | boolean>,
) => ({
  t: 'update' as const,
  table: comp,
  set: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, val(v)])),
  where: eq(
    col('entity'),
    sub(select({
      cols: [col('id')],
      from: table('entity'),
      where: eq(col('eid'), val(eid)),
    })),
  ),
})

let named = file(), unlogged = file(['position']), rolled = file()

test('another connection that wrote one entity has only it read again', () => {
  named.b.query(set('player', 'other', { active: false }))
  equal(named.read(['hero', 'other']), {
    found: [[{ active: true }, { x: 0 }], [{ active: false }, undefined]],
    asked: [['other']],
  })
})

test('a write to a table the log does not follow lets every entity go', () => {
  unlogged.b.query(set('position', 'hero', { x: 2 }))
  equal(unlogged.read(['hero']).found, [[{ active: true }, { x: 2 }]])
})

// The log rows a transaction wrote and read before it rolled back are gone,
// and the next writer's rows take their places.
test('what a rolled-back transaction read of the log is read again', () => {
  let { a, b, read } = rolled
  b.query(set('position', 'hero', { x: 1 }))
  a.query({ t: 'begin' })
  a.query(set('position', 'hero', { x: 5 }))
  read(['other'])
  a.query({ t: 'rollback' })
  read(['hero'])
  b.query(set('position', 'hero', { x: 7 }))
  equal(read(['hero']).found, [[{ active: true }, { x: 7 }]])
})

// A read of more entities than a quarter of what memory keeps (one for every
// 2 KiB) is a scan, and not kept; memory given more keeps more.
let mob = Array.from({ length: 20 }, (_, i) => `mob-${i}`)
let bundles = mob.map((eid): Bundle => ({
  entity: { eid },
  position: { x: 1 },
}))
let twice = (memory: number) => {
  let memo = memoized(mem(), vocab, {}, memory), reads = 0
  let read = () => memo.get(() => (reads++, bundles), mob)
  read()
  read()
  return reads
}

test('a read too large for what memory keeps is read again', () => {
  equal(twice(64 << 10), 2)
})

test('memory given more keeps a larger read', () => {
  equal(twice(256 << 10), 1)
})
