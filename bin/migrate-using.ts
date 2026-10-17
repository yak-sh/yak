// T-127093 one-time migration; remove this script in the next commit.
// deno run -A bin/migrate-using.ts /absolute/path/to/yak.db <session-eid>
// Run on the VACUUM INTO copy first. Live follows backup and land, immediately
// followed by yak restart. Historical journal after-images stay immutable.
import { type Bundle, type Comp, graph, token } from '@yaks/graph'
import { loadVocab, pick } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { reclassify, storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { journal, log } from '@yaks/journal'
import {
  and,
  as,
  col,
  eq,
  type Expr,
  fn,
  join,
  lit,
  oneOf,
  or,
  select,
  table,
  val,
} from '@yaks/sql'

const [path, actor] = Deno.args
if (!path || !actor) {
  throw new Error('Usage: migrate-using.ts <db> <session-eid>')
}
const sql = open(path)
const props = {
  input: { type: 'object' },
  instructions: { type: 'string' },
  window: { type: 'integer' },
  tools: { type: 'array', items: { type: 'string' } },
}
const names = Object.keys(props)
const columns = () =>
  sql.query({ t: 'pragma', name: 'table_info', arg: 'using' }).map((r) =>
    String(r.name)
  )
const left = names.filter((p) => columns().includes(p))
if (!left.length) {
  console.log(
    JSON.stringify({ changed: 0, columns: columns(), idempotent: true }),
  )
  sql.close()
  Deno.exit(0)
}
const retained = {
  provider: { type: 'string', ref: 'entity', death: 'keep' },
  model: { type: 'string', ref: 'entity', death: 'keep' },
  effort: { type: 'string' },
}
// Omitting provenance declarations preserves every original created/updated
// stamp. The journal records the migration as its own actor, not the owner.
const vocab = loadVocab([archetypeDoc, pick(kernelDoc, ['entity']), {
  title: 'using-migration',
  $defs: {
    using: {
      component: true,
      type: 'object',
      properties: {
        ...retained,
        ...Object.fromEntries(
          left.map((p) => [p, props[p as keyof typeof props]]),
        ),
      },
    },
    sending: { component: true, type: 'object', properties: props },
    call: {
      component: true,
      type: 'object',
      properties: { args: { type: 'object' } },
    },
    board: {
      component: true,
      type: 'object',
      properties: { query: { type: 'string' } },
    },
    builder: {
      component: true,
      type: 'object',
      properties: { query: { type: 'string' } },
    },
    wake: {
      component: true,
      type: 'object',
      properties: { while: { type: 'array', items: { type: 'object' } } },
    },
  },
}])
const store = storage(sql, vocab, { schemaReady: () => true })
store.install()
const g = graph({ storage: store, vocab })
g.use(journal(log({ rows: (s) => sql.query(s) }), vocab))
const ids = (comp: string, where?: Expr) =>
  sql.query(select({
    cols: [col('eid', 'e')],
    from: table(comp, 'c'),
    joins: [join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'c')))],
    ...(where ? { where } : {}),
  })).map((r) => String(r.eid))
const notNull = (e: Expr): Expr => ({ t: 'null', e, not: true })
const signed = (b: Bundle): Bundle => ({
  ...b,
  $actor: { by: actor, via: actor },
})
const moved: Record<string, number> = Object.fromEntries(
  names.map((n) => [n, 0]),
)
const proof: Array<[string, string, unknown]> = []
const owners = ids('using', or(...left.map((p) => notNull(col(p, 'c')))))
const stamps = () =>
  ['created', 'updated'].map((c) =>
    sql.query(select({
      cols: [col('eid', 'e'), { t: 'star', of: 'c' }],
      from: table(c, 'c'),
      joins: [
        join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'c'))),
      ],
      where: oneOf(col('eid', 'e'), owners),
      order: [col('eid', 'e')],
    }))
  )
const beforeStamps = token(stamps())
let changed = 0, sourceOnly = 0, calls = 0, queries = 0
try {
  for (let i = 0; i < owners.length; i += 100) {
    const rows = await g.get(owners.slice(i, i + 100), ['using', 'sending'])
    const patches: Bundle[] = []
    for (const b of rows) {
      const source = b.using as Comp, target = b.sending as Comp | undefined
      const sending: Comp = {}, clearing: Comp = {}
      const sourceWas: Record<string, string | null> = {},
        targetWas: Record<string, string | null> = {}
      for (const p of left) {
        const value = source[p]
        sourceWas[p] = token(value)
        targetWas[p] = token(target?.[p])
        if (value == null) continue
        if (
          target?.[p] != null &&
          JSON.stringify(target[p]) !== JSON.stringify(value)
        ) throw new Error(`Conflicting sending.${p} on ${b.entity.eid}`)
        sending[p] = value
        clearing[p] = null
        moved[p]++
        proof.push([b.entity.eid, p, value])
      }
      const only = Object.keys(retained).every((p) => source[p] == null)
      for (const p of Object.keys(retained)) sourceWas[p] = token(source[p])
      if (Object.keys(sending).length) {
        if (only) sourceOnly++
        patches.push(
          signed({
            entity: b.entity,
            using: only ? null : clearing,
            sending,
            $was: { using: sourceWas, sending: targetWas },
          }),
        )
      }
    }
    if (patches.length) {
      await store.tx(async () => {
        await g.apply(patches)
        reclassify(sql, patches.map((b) => b.entity.eid))
      })
      changed += patches.length
    }
  }
  // Only builder model requests have this envelope; arbitrary tool args are
  // user content and are never recursively rewritten.
  const modelTools = sql.query(
    select({
      cols: [col('entity')],
      from: table('tool'),
      where: eq(col('name'), val('builder_model')),
    }),
  ).map((r) => Number(r.entity))
  const callIds = ids(
    'call',
    and(
      oneOf(col('to', 'c'), modelTools),
      eq(fn('json_type', col('args', 'c'), val('$.using')), val('object')),
    ),
  )
  for (const id of callIds) {
    const [b] = await g.get([id], ['call'])
    const args = (b.call as Comp).args as Record<string, unknown>
    const using = args.using as Record<string, unknown>
    const nextUsing = { ...using },
      sending = { ...(args.sending as Record<string, unknown> | undefined) }
    let any = false
    for (const p of names) {
      if (!Object.hasOwn(nextUsing, p)) continue
      if (nextUsing[p] != null) {
        if (
          sending[p] != null &&
          JSON.stringify(sending[p]) !== JSON.stringify(nextUsing[p])
        ) throw new Error(`Conflicting call.args.sending.${p} on ${id}`)
        sending[p] = nextUsing[p]
      }
      delete nextUsing[p]
      any = true
    }
    if (any) {
      await g.apply([
        signed({
          entity: b.entity,
          call: {
            args: {
              ...args,
              using: nextUsing,
              ...(Object.keys(sending).length ? { sending } : {}),
            },
          },
          $was: { call: { args: token(args) } },
        }),
      ])
      calls++
    }
  }
  const rewrite = (q: string) =>
    q.replace(/\busing\.(input|instructions|window|tools)\b/g, 'sending.$1')
  for (const c of ['board', 'builder', 'wake']) {
    for (const id of ids(c)) {
      const [b] = await g.get([id], [c]), held = b[c] as Comp
      const property = c === 'wake' ? 'while' : 'query', old = held[property]
      const next = c === 'wake' && Array.isArray(old)
        ? old.map((rule) =>
          typeof rule?.match === 'string'
            ? { ...rule, match: rewrite(rule.match) }
            : rule
        )
        : typeof old === 'string'
        ? rewrite(old)
        : old
      if (JSON.stringify(old) !== JSON.stringify(next)) {
        await g.apply([
          signed({
            entity: b.entity,
            [c]: { [property]: next },
            $was: { [c]: { [property]: token(old) } },
          }),
        ])
        queries++
      }
    }
  }
  const verified: typeof proof = []
  for (let i = 0; i < owners.length; i += 100) {
    const rows = await g.get(owners.slice(i, i + 100), ['using', 'sending'])
    for (const b of rows) {
      for (
        const [eid, p, value] of proof.filter(([id]) => id === b.entity.eid)
      ) {
        const actual = (b.sending as Comp | undefined)?.[p]
        if (
          token(actual) !== token(value) ||
          (b.using as Comp | undefined)?.[p] != null
        ) throw new Error(`Conservation failed ${eid}.${p}`)
        verified.push([eid, p, actual])
      }
    }
  }
  const order = (a: typeof proof[number], b: typeof proof[number]) =>
    `${a[0]}.${a[1]}`.localeCompare(`${b[0]}.${b[1]}`)
  const beforeValues = token(proof.sort(order)),
    afterValues = token(verified.sort(order))
  if (beforeValues !== afterValues) throw new Error('Value digest mismatch')
  const afterStamps = token(stamps())
  if (beforeStamps !== afterStamps) throw new Error('Provenance stamps changed')
  await store.tx(() => {
    for (const p of left) {
      const count = sql.query(
        select({
          cols: [as(fn('count', lit(1)), 'n')],
          from: table('using'),
          where: notNull(col(p)),
        }),
      )[0].n
      if (Number(count)) throw new Error(`using.${p} still has ${count} values`)
    }
    // Structural contraction changes no component presence: graph applies above
    // already maintained archetypes. SQLite's AST is the only DDL writer here.
    for (const p of left) {
      sql.query({ t: 'alter table', table: 'using', drop: p })
    }
  })
  console.log(JSON.stringify({
    changed,
    sourceOnly,
    moved,
    calls,
    queries,
    beforeValues,
    afterValues,
    beforeStamps,
    afterStamps,
    columns: columns(),
    graphSendingRows: (await g.read('.sending')).length,
    journal: 'immutable after-images retained',
  }))
} finally {
  sql.close()
}
