// Populations survive classification, graves, rollback and another file opener.
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { by, catalogue, col, insert, select, table } from '@yaks/sql'
import { storage } from './mod.ts'
import { open } from './db.ts'
import { mem, stepping } from './testing.ts'
import { census, POPULATION, population, populations } from './population.ts'
import { unit } from './unit.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: { component: true, type: 'object' },
    note: {
      component: true,
      type: 'object',
      properties: { text: { type: 'string' } },
    },
    mark: { component: true, type: 'object' },
  },
}])
let fixture = () => {
  let d = mem(), store = storage(d, vocab)
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  return { d, store, g }
}
let f = fixture()
let count = (line = '.note&.count') => Number(f.store.rows(line)[0]?.n)
f.g.apply([{ entity: { eid: 'a' }, note: { text: 'one' } }, {
  entity: { eid: 'b' },
  note: {},
}])
let trace = [count()]
f.g.apply([{ entity: { eid: 'a' }, note: { text: 'two' } }])
trace.push(count())
f.g.apply([{ entity: { eid: 'a' }, mark: {} }])
trace.push(count(), count('.mark&.count'))
f.g.apply([{ entity: { eid: 'b' }, $delete: true }])
trace.push(count())
f.g.apply([{ entity: { eid: 'b' }, note: {} }])
trace.push(count())
let total = count('.count')
let tally = f.store.rows('.tally=entity.archetype')
test('population follows new, reclassified, deleted and resurrected owners', () => {
  assertEquals(trace, [2, 2, 2, 1, 1, 2])
  assertEquals(tally.reduce((n, r) => n + Number(r.n), 0), total)
})

let before = f.store.rows('.tally=entity.archetype')
assertThrows(() =>
  f.store.tx((tx) => {
    tx.patch([{ entity: { eid: 'b' }, mark: {} }])
    throw Error('no commit')
  })
)
let rolled = f.store.rows('.tally=entity.archetype')
let [id] = f.d.query(
  select({ cols: [col('id')], from: table('entity'), where: by({ eid: 'b' }) }),
)
f.d.query(insert('tombstone', { entity: Number(id.id), deleted_at: 'now' }))
let grave = count()
f.d.query({
  t: 'delete',
  from: 'tombstone',
  where: by({ entity: Number(id.id) }),
})
let ungrave = count()
test('population rollback is atomic and raw graves move liveness before classification', () => {
  assertEquals(rolled, before)
  assertEquals([grave, ungrave], [1, 2])
})

// An old file has descriptors and owners but no counters. Seed exactly once,
// then close its connection and reopen the persisted metadata through a reader.
let dir = Deno.makeTempDirSync({ prefix: 'population-' })
let file = `${dir}/graph.db`
let disk = open(file), diskStore = storage(disk, vocab, { counts: 'eager' })
diskStore.install()
let diskGraph = graph({ storage: diskStore, vocab, plugins: [archetypes()] })
diskGraph.apply([{ entity: { eid: 'old' }, note: { text: 'kept' } }])
for (let kind of ['trigger', 'table'] as const) {
  for (let o of catalogue(disk)) {
    if (o.type == kind && /^_yaks_(population|membership)/.test(o.name)) {
      disk.query({ t: 'drop', kind, name: o.name })
    }
  }
}
unit(disk, () => population(disk))
unit(disk, () => population(disk))
disk.close()
let again = open(file), reopened = storage(again, vocab)
reopened.install()
let migrated = reopened.rows('.note&.count')
let kept = reopened.get(['old'], ['note'])[0]?.note
again.close()
Deno.removeSync(dir, { recursive: true })
test('an existing file seeds once and another opener reads persisted population', () => {
  assertEquals(migrated, [{ value: '', n: 1 }])
  assertEquals(kept, { text: 'kept' })
})

// A spine respun before it raised its other triggers again kept the counts
// and lost the triggers moving them (T-164366): owners born after it were
// never counted, and each one deleted still was, so yaks.app's directory
// counted 1,070 of 1,195 deploys. Counts with a trigger missing are not read,
// and the next count seeds them anew.
let respun = fixture()
let born = (n: number, from = 0) =>
  respun.g.apply(
    Array.from({ length: n }, (_, i) => ({
      entity: { eid: `respun${from + i}` },
      note: {},
    })),
  )
born(3)
Number(respun.store.rows('.note&.count')[0].n)
for (let event of ['insert', 'delete', 'update']) {
  respun.d.query({ t: 'drop', kind: 'trigger', name: `${POPULATION}_${event}` })
}
let lost = populations(respun.d)
born(4, 3)
respun.g.apply([{ entity: { eid: 'respun0' }, $delete: true }])
let heal = (line: string) => Number(respun.store.rows(line)[0].n)
let healed = heal('.note&.count')
let mended = populations(respun.d)?.reduce((n, b) => n + b.n, 0)
let whole = Number(respun.store.rows('.entity.eid&.count')[0].n)
born(1, 7)
let after = heal('.note&.count')
test('counts that lost a trigger are seeded anew rather than read', () => {
  assertEquals(lost, undefined)
  assertEquals(healed, 6)
  assertEquals(mended, whole)
  assertEquals(after, 7)
})

let observed = fixture()
observed.g.apply(
  Array.from(
    { length: 500 },
    (_, i) => ({ entity: { eid: `owner${i}` }, note: { text: 'same' } }),
  ),
)
let plain = observed.store.rows('.note&.count')
let filtered = observed.store.rows('.note.text=same&.count')
let buckets = populations(observed.d)!
test('plain and filtered cardinalities agree while global queries read buckets', () => {
  assertEquals(plain, [{ value: '', n: 500 }])
  assertEquals(filtered, plain)
  assertEquals(
    buckets.filter((b) => b.tables.includes('note')).reduce(
      (n, b) => n + b.n,
      0,
    ),
    500,
  )
})

// Every host defers population upkeep until its first global count.
let lazyDb = mem(), lazy = storage(lazyDb, vocab)
lazy.install()
let lazyGraph = graph({ storage: lazy, vocab, plugins: [archetypes()] })
lazyGraph.apply([{ entity: { eid: 'lazy-one' }, note: {} }])
let filteredLazy = lazy.rows('.note.text=not-here&.count')
let dormant = lazyDb.query({ t: 'pragma', name: 'table_info', arg: POPULATION })
let seeded = lazy.rows('.note&.count')
let lazyReopened = storage(lazyDb, vocab)
lazyReopened.install()
lazyGraph.apply([{ entity: { eid: 'lazy-two' }, note: {} }])
let resumed = lazyReopened.rows('.note&.count')
let extensionCount = storage(lazyDb, vocab, {
  counts: 'lazy',
  extend: [{ name: 'unrelated', compile: {} }],
}).rows('.note&.count')
test('lazy populations activate once, survive reopen and permit unrelated query extensions', () => {
  assertEquals(filteredLazy, [{ value: '', n: 0 }])
  assertEquals(dormant, [])
  assertEquals(seeded, [{ value: '', n: 1 }])
  assertEquals(resumed, [{ value: '', n: 2 }])
  assertEquals(extensionCount, resumed)
})

test('unknown component counts retain compiler refusal', () => {
  assertThrows(() => f.store.rows('.unknown_component&.count'))
})

// A caller that plans to count at once can move the seed to installation.
let eagerDb = mem(), eager = storage(eagerDb, vocab, { counts: 'eager' })
eager.install()
let eagerGraph = graph({ storage: eager, vocab, plugins: [archetypes()] })
eagerGraph.apply([{ entity: { eid: 'eager-one' }, note: {} }])
let eagerBuckets = populations(eagerDb)!
let eagerCount = eager.rows('.note&.count')
test('explicit eager populations are maintained before a first count', () => {
  assertEquals(
    eagerBuckets.filter((b) => b.tables.includes('note')).reduce(
      (n, b) => n + b.n,
      0,
    ),
    1,
  )
  assertEquals(eagerCount, [{ value: '', n: 1 }])
})

// The API hides mutation receipts through an entity-presence policy. Counts
// must keep that policy without abandoning the maintained bucket metadata.
let scoped = fixture()
scoped.g.apply([
  { entity: { eid: 'shown' }, note: { text: 'public' } },
  { entity: { eid: 'hidden' }, note: { text: 'private' }, mark: {} },
])
let visibility = { entity: '!mark', components: {} }
let bucketReads = 0, ownerReads = 0
let observedDriver = {
  ...scoped.d,
  query: (s: Parameters<typeof scoped.d.query>[0]) => {
    if (s.t == 'select' && !Array.isArray(s.from) && s.from?.t == 'table') {
      if (s.from.name == POPULATION) bucketReads++
      if (s.from.name == 'entity' && s.limit == undefined) ownerReads++
    }
    return scoped.d.query(s)
  },
}
let scopedStore = storage(observedDriver, vocab)
let scopedCount = scopedStore.rows('.note&.count', { visibility })
let scopedTally = scopedStore.rows('.tally=entity.archetype', { visibility })
let policyReads = { bucketReads, ownerReads }
let scopedTruth = scoped.store.rows('.note.text=public&.count')
let scopedSet = scoped.store.read('.note.text=public')[0].entity.archetype
let hiddenSet = scoped.store.read('.note.text=private')[0].entity.archetype
let valueScoped = scopedStore.rows('.note&.count', {
  visibility: { entity: '.note.text=private' },
})
let componentScoped = scopedStore.rows('.note&.count', {
  visibility: { components: { note: '.note.text=private' } },
})
test('presence visibility counts only admitted buckets without scanning owners', () => {
  assertEquals(scopedCount, scopedTruth)
  assertEquals(scopedTally.filter((r) => r.value == scopedSet), [{
    value: scopedSet,
    n: 1,
  }])
  assertEquals(scopedTally.some((r) => r.value == hiddenSet), false)
  assertEquals(policyReads, { bucketReads: 2, ownerReads: 0 })
})
test('value and component visibility retain ordinary scoped cardinalities', () => {
  assertEquals(valueScoped, [{ value: '', n: 1 }])
  assertEquals(componentScoped, [{ value: '', n: 1 }])
})

// A clause that doesn't narrow a count (`?comp`, `?comp.prop`, `.order`,
// `.limit`, `.after`) keeps it on the buckets.
let idle = (line: string) => {
  bucketReads = ownerReads = 0
  let n = scopedStore.rows(line, { visibility })[0].n
  return { n, bucketReads: Math.sign(bucketReads), ownerReads }
}
let all = idle('.count'), notes = idle('.note&.count')
test('a plain count reads the populations', () => {
  assertEquals([all, notes].map((r) => r.bucketReads), [1, 1])
})
let clauses = {
  '?note&.count': all,
  '?note.text&.count': all,
  '.count&.limit=1': all,
  '.note&?mark&.count': notes,
  '.note&.order=-note.text&.count': notes,
}
for (let [line, want] of Object.entries(clauses)) {
  test(`${line} keeps its plain count on the populations`, () => {
    assertEquals(idle(line), want)
  })
}

// A census answers each question once while the rows it read stand: the reads
// of one Inbox summary share it, and the next write asks again.
let looked = fixture()
looked.g.apply([{ entity: { eid: 'n' }, note: {} }])
let statements = 0
let run = looked.d.query
looked.d.query = (s) => (statements++, run(s))
let asks = () => {
  let c = census(looked.d)
  let answers = [c.exceeds!('note', 0), c.exceeds!('note', 1)]
  return { answers, statements }
}
let firstAsks = asks(), againAsks = asks()
looked.g.apply([{ entity: { eid: 'm' }, note: {} }])
let afterWrite = asks()
test('a census looks at a table once while its rows stand', () => {
  assertEquals(firstAsks.answers, [true, false])
  assertEquals(againAsks.statements, firstAsks.statements)
  assertEquals(afterWrite.answers, [true, true])
})

// An entity that gains and loses components wears a new archetype each time,
// and the old ones are kept. A count reads the archetypes worn now: the
// directory's 404 apps had worn 674, and a count of them read every one
// (T-4230).
let tags = ['t0', 't1', 't2', 't3', 't4', 't5', 't6']
let worn = loadVocab([archetypeDoc, {
  $defs: Object.fromEntries(
    ['entity', 'app', 'test', ...tags].map((c) => [c, {
      component: true,
      type: 'object',
    }]),
  ),
}])
let churned = (moves: number) => {
  let meter = stepping(), store = storage(meter.driver, worn)
  store.install()
  let g = graph({ storage: store, vocab: worn, plugins: [archetypes()] })
  g.apply(Array.from({ length: 8 }, (_, i) => ({
    entity: { eid: `app${i}` },
    app: {},
    ...i == 0 ? { test: {} } : {},
  })))
  let count = (line: string) => Number(store.rows(line)[0].n)
  count('.app&.count')
  for (let m = 1; m <= moves; m++) {
    g.apply([{
      entity: { eid: `app${m % 8}` },
      ...Object.fromEntries(tags.map((t, i) => [t, m >> i & 1 ? {} : null])),
    }])
  }
  // Every app ends where it began, wearing `app` alone, or `app` and `test`.
  g.apply(Array.from({ length: 8 }, (_, i) => ({
    entity: { eid: `app${i}` },
    ...Object.fromEntries(tags.map((t) => [t, null])),
  })))
  let cost = (line: string) => {
    let before = meter.steps(), n = count(line)
    return { n, steps: meter.steps() - before }
  }
  return {
    apps: cost('.app&.count'),
    real: cost('.app&!test&.count'),
    tests: cost('.app&.test&.count'),
  }
}
let still = churned(0), moved = churned(120)
test('a count reads the archetypes worn now, not every one worn before', () => {
  for (let k of ['apps', 'real', 'tests'] as const) {
    assertEquals(moved[k].n, still[k].n)
    // A page of the b-tree more or less, never a bucket per archetype worn.
    assert(moved[k].steps < still[k].steps + 10, `${k}: ${moved[k].steps}`)
  }
  assertEquals([still.apps.n, still.real.n, still.tests.n], [8, 7, 1])
})

// A membership that lost a part is made again from the counts that stand,
// and holds the archetypes worn now.
let torn = fixture()
torn.g.apply([
  { entity: { eid: 'kept' }, note: {} },
  { entity: { eid: 'moved' }, note: {} },
])
Number(torn.store.rows('.note&.count')[0].n)
torn.g.apply([{ entity: { eid: 'moved' }, mark: {} }])
torn.d.query({ t: 'drop', kind: 'table', name: '_yaks_membership' })
let remade = ['.note&.count', '.mark&.count'].map((line) =>
  Number(torn.store.rows(line)[0].n)
)
let held = torn.d.query(
  select({ cols: [col('archetype')], from: table('_yaks_membership') }),
)
test('a membership is made again from the counts, of the archetypes worn', () => {
  assertEquals(remade, [2, 1])
  assertEquals(
    new Set(held.map((r) => r.archetype)).size,
    populations(torn.d)!.length,
  )
})
