// A read filtered by a computed property's one value fills its rows in with
// that value, not by computing it again (@yaks/sql `pinned`); any other filter
// leaves the gather to the expression. Either way the answer is what reading
// each entity back says.
import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import {
  col,
  type Derived,
  eq,
  exists,
  lit,
  render,
  select,
  type Stmt,
  table,
  when,
} from '@yaks/sql/core'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { mem } from './testing.ts'

let v = loadVocab({
  $defs: {
    job: {
      component: true,
      type: 'object',
      properties: {
        name: { type: 'string' },
        status: { type: 'string', computed: true },
      },
    },
    failed: { component: true, type: 'object' },
  },
})
let derived: Derived = {
  'job.status': {
    tag: 'text',
    values: ['failed', 'pending'],
    expr: (owner) =>
      when([[
        exists(select({
          cols: [lit(1)],
          from: table('failed', '__rule'),
          where: eq(col('entity', '__rule'), owner),
        })),
        lit('failed'),
      ]], lit('pending')),
  },
}
// How many statements a read ran that work out a job's status.
let ruled = 0
let base = mem()
let driver = {
  ...base,
  query: (s: Stmt) => {
    if (render(s).sql.includes('"__rule"')) ruled++
    return base.query(s)
  },
}
let s = storage(driver, v, { derived })
s.install()
let g = graph({ storage: s, vocab: v })
g.apply([
  { entity: { eid: 'a' }, job: { name: 'a' }, failed: {} },
  { entity: { eid: 'b' }, job: { name: 'b' } },
  { entity: { eid: 'c' }, job: { name: 'c' } },
  { entity: { eid: 'd' } },
], { trusted: true })

for (
  let [query, pinned] of [
    ['.job.status=failed', true],
    ['.job.status=pending', true],
    ['.job .job.status=pending .job.name=c', true],
    ['.job.status=bogus', true],
    ['.job.status=pending,failed', false],
    ['.job.status!=failed', false],
  ] as const
) {
  test(`${query} computes the status ${pinned ? 'once' : 'again'}`, async () => {
    let before = ruled
    let found = await g.read(query)
    let n = ruled - before
    pinned ? equal(n, 1) : ok(n > 1, String(n))
    equal(found, await g.get(found.map((b) => b.entity.eid), ['job']))
  })
}
