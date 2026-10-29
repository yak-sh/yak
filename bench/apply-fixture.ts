// graph.apply over the fleet corpus, with the packages' production vocabulary
// and graph plugins. Every sample owns its store; creates never become edits.
import { open } from '@yaks/sqlite/db'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { stamps } from './vocabulary.ts'
import { docDoc, docs } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges, traverse } from '@yaks/edge'
import { taskDoc, tasks } from '@yaks/task'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools'
import { modelDoc } from '@yaks/model'
import { contextDoc } from '@yaks/context'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { effectDoc, effects } from '@yaks/effects'
import { ddl, journal, log } from '@yaks/journal'
import { storage } from '@yaks/sqlite'
import { ram } from '@yaks/ram'
import { eid, workload } from '../packages/sqlite/fixtures/fleet.ts'

import { sqlStatements } from './sql-counts.ts'
import { fixture } from './fixture.ts'
import { APPLY_MODES, APPLY_SHAPES, APPLY_SIZES, APPLY_WORK } from './names.ts'
export const applyVocab = loadVocab([
  kernelDoc,
  ...await stamps([kernelDoc]),
  docDoc,
  edgeDoc,
  taskDoc,
  sessionDoc,
  toolsDoc,
  modelDoc,
  contextDoc,
  archetypeDoc,
  effectDoc,
], [kernelKeywords, edgeKeywords])

let seed: Bundle[] | undefined
function seeded() {
  if (!seed) {
    let g = graph({
      storage: ram(applyVocab, { number: true }),
      vocab: applyVocab,
      plugins: plugins(),
    })
    g.apply(workload().bundles, { trusted: true })
    seed = g.read('.entity *') as Bundle[]
  }
  return seed
}
let plugins = () => [
  kernel(),
  docs(),
  edges(applyVocab),
  tasks(),
  sessions(),
  archetypes(),
  effects(applyVocab),
]

let prepared = (db?: ReturnType<typeof open>) => {
  let store = db
    ? storage(db, applyVocab, {
      number: true,
      extend: [traverse(applyVocab)],
    })
    : ram(applyVocab, { number: true })
  let g = graph({ storage: store, vocab: applyVocab, plugins: plugins() })
  g.install()
  if (db) {
    for (let stmt of ddl()) db.query(stmt)
    g.use(journal(log({ rows: (stmt) => db.query(stmt) }), applyVocab))
  }
  return { g, store }
}

let fileSeed = fixture(async (path: string) => {
  let db = open(path)
  try {
    let { store } = prepared(db)
    store.tx((tx) => tx.patch(seeded()))
  } finally {
    db.close()
  }
})

export async function applyFixture(mode: 'file' | 'ram') {
  let dir = mode == 'file'
    ? await Deno.makeTempDir({ prefix: 'yaks-apply-bench-' })
    : undefined
  let db: ReturnType<typeof open> | undefined
  let close = () => {
    db?.close()
    if (dir) Deno.removeSync(dir, { recursive: true })
  }
  try {
    if (dir) {
      let path = `${dir}/graph.sqlite`
      await fileSeed(path)
      db = open(path)
    }
    let { g, store } = prepared(db)
    if (db) {
      // The original seed populated this connection's page cache. Read the
      // copied corpus too, so copying the file does not make timed work cold.
      assertEquals((g.read('.entity *') as Bundle[]).length, seeded().length)
    } else store.tx((tx) => tx.patch(seeded()))
    // Warm the same graph pipeline and stamp shapes on every private copy.
    // The checkpoint and final write leave the WAL in the original state.
    for (let i = 0; i < 20; i++) {
      if (i == 19) db?.query({ t: 'pragma', name: 'wal_checkpoint' })
      g.apply([{ entity: { eid: eid(1) }, doc: { title: `Warm ${i}` } }])
    }
    return { g, close }
  } catch (error) {
    close()
    throw error
  }
}

export function applyBundles(work: 'edit' | 'create', n: number): Bundle[] {
  return Array.from({ length: n }, (_, i) => ({
    entity: { eid: work == 'edit' ? eid(i + 1) : eid(10000 + i) },
    doc: { title: `Apply baseline ${i}` },
    ...(work == 'create' ? { task: {} } : {}),
    $actor: { by: eid(0), via: eid(0) },
  }))
}
export function runApplies(
  f: Awaited<ReturnType<typeof applyFixture>>,
  bundles: Bundle[],
  shape: 'alone' | 'batch',
) {
  if (shape == 'batch') return f.g.apply(bundles)
  return bundles.flatMap((b) => f.g.apply([b]) as Bundle[])
}
export function verifyApplies(
  f: Awaited<ReturnType<typeof applyFixture>>,
  bundles: Bundle[],
) {
  let rows = f.g.get(bundles.map((b) => b.entity.eid)) as Bundle[]
  assertEquals(
    rows.map((b) => (b.doc as { title: string }).title),
    bundles.map((b) => (b.doc as { title: string }).title),
  )
  assertEquals(rows.every((b) => !!b.created && !!b.entity.archetype), true)
}
export async function measureApplyCounts() {
  let counts: Record<string, { sqlPerApply: number; sqlPerBundle: number }> = {}
  for (let mode of APPLY_MODES) {
    for (let work of APPLY_WORK) {
      for (let n of APPLY_SIZES) {
        for (let shape of APPLY_SHAPES) {
          let counter = sqlStatements()
          let f: Awaited<ReturnType<typeof applyFixture>> | undefined
          try {
            f = await applyFixture(mode)
            let bundles = applyBundles(work, n)
            counter.reset()
            runApplies(f, bundles, shape)
            counts[`apply/${mode}/${work}-${shape}-${n}`] = {
              sqlPerApply: counter.count() / (shape == 'alone' ? n : 1),
              sqlPerBundle: counter.count() / n,
            }
            verifyApplies(f, bundles)
          } finally {
            f?.close()
            counter.close()
          }
        }
      }
    }
  }
  return counts
}
if (import.meta.main) console.log(JSON.stringify(await measureApplyCounts()))
