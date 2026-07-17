// Write-path baselines: apply() batches and snapshot() reads at the scale
// the migration will push (thousands of entities). `deno task bench`.
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, snapshot } = await import('./db.ts')

let uid = () => crypto.randomUUID()
let task = (eid: string, i: number) => [
  { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(200) } },
  { eid, name: 'task', comp: { status: 'open', priority: i % 3 } },
]

// A resident graph of 2k tasks for the read benches.
let eids = Array.from({ length: 2000 }, uid)
eids.forEach((eid, i) => apply(db, task(eid, i)))

Deno.bench('apply: mint one task (2 comps)', () => {
  apply(db, task(uid(), 0))
})

Deno.bench('apply: 100-task batch', () => {
  apply(db, Array.from({ length: 100 }, (_, i) => task(uid(), i)).flat())
})

Deno.bench('apply: patch one column', () => {
  apply(db, [{ eid: eids[7], name: 'task', comp: { priority: 2 } }])
})

Deno.bench('snapshot: full graph', () => {
  snapshot(db)
})
