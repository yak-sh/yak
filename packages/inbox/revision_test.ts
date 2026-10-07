// Completed summaries may be reused only under a store-proven data revision.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { archetypeDoc } from '@yaks/archetype'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { inboxDoc } from './vocab.ts'
import { plugins } from './graph.ts'
import { summaryQuery } from './queries.ts'

test('summary reuse is exact, mutation-safe, and invalidated by another SQLite connection', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'T-66332-summary-revision-' })
  let v = loadVocab([
    kernelDoc,
    docDoc,
    taskDoc,
    projectDoc,
    archetypeDoc,
    inboxDoc,
  ])
  let a = open(`${dir}/graph.db`), b = open(`${dir}/graph.db`)
  let sa = storage(a, v), sb = storage(b, v)
  sa.install()
  let reads = 0, read = sa.read.bind(sa), rows = sa.rows.bind(sa)
  sa.read = (q, opts, comps) => {
    reads++
    return read(q, opts, comps)
  }
  sa.rows = (q, opts) => {
    reads++
    return rows(q, opts)
  }
  let g: Graph
  g = graph({
    vocab: v,
    storage: sa,
    plugins: plugins({
      get graph() {
        return g
      },
    }),
  })
  try {
    sb.tx((tx) =>
      tx.patch([
        { entity: { eid: 'person' }, doc: { title: 'Person' } },
        {
          entity: { eid: 'work' },
          task: {},
          filed: { assignee: 'person' },
          doc: { title: 'Original' },
        },
      ])
    )
    let line = summaryQuery('person')
    let first = await g.read(line)
    let count = reads
    let summary = (rs: Bundle[]) =>
      rs[0].inbox_summary as {
        threads: { eid: string; row: { comps: { doc: { title: string } } } }[]
      }
    equal(summary(first).threads.map((t) => t.eid), ['work'])
    summary(first).threads[0].row.comps.doc.title = 'caller mutation'
    let second = await g.read(line)
    equal(summary(second).threads[0].row.comps.doc.title, 'Original')
    // The view's empty candidate read still runs; no metadata history is read.
    ok(reads - count <= 1, `${reads - count} reads after a warm summary`)
    sb.tx((tx) =>
      tx.patch([{
        entity: { eid: 'later' },
        task: {},
        filed: { assignee: 'person' },
      }])
    )
    let changed = await g.read(line)
    equal(summary(changed).threads.map((t) => t.eid).sort(), ['later', 'work'])
    sb.tx((tx) =>
      tx.patch([{ entity: { eid: 'work' }, archived: { at: '9999-01-01' } }])
    )
    equal(summary(await g.read(line)).threads.map((t) => t.eid), ['later'])
  } finally {
    a.close()
    b.close()
    await Deno.remove(dir, { recursive: true })
  }
})
