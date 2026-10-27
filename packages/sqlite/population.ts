// Exact entity populations by archetype. One migration reads existing owners;
// afterwards entity triggers move only the old and new buckets, in the same
// transaction as the entity. Ordinary component property writes do no work.
import { type And, bare, parse } from '@yaks/query/core'
import type { Vocab } from '@yaks/vocab'
import {
  and,
  as,
  type BindOpts,
  call,
  type Census,
  col,
  count,
  derivedOf,
  type Driver,
  eq,
  exists,
  fn,
  gt,
  isNull,
  lit,
  not,
  notNull,
  op,
  select,
  type Stmt,
  table,
} from '@yaks/sql'
export let installed = (driver: Driver) =>
  driver.query({ t: 'pragma', name: 'table_info', arg: POPULATION }).length > 0

export const POPULATION = '_yaks_population'
export const POPULATION_VERSION = 1
const MEMBERSHIP = '_yaks_membership'

let increment = (which: 'new' | 'old', n: number): Stmt => ({
  t: 'insert',
  into: POPULATION,
  cols: ['archetype', 'n'],
  q: select({
    cols: [col('archetype', which), lit(n)],
    where: and(
      notNull(col('archetype', which)),
      not(exists(select({
        cols: [lit(1)],
        from: table('tombstone'),
        where: eq(col('entity'), col('id', which)),
      }))),
    ),
  }),
  upsert: [{ on: [col('archetype')], set: { n: op('+', col('n'), lit(n)) } }],
})

/** Install once, after the entity schema and its archetype backfill stand.
 * Seeding and the triggers commit together; another opener sees both or none. */
export let population = (driver: Driver): void => {
  if (installed(driver)) return
  driver.query({
    t: 'create table',
    name: POPULATION,
    cols: [{ name: 'archetype', type: 'integer', pk: true }, {
      name: 'n',
      type: 'integer',
      notNull: true,
    }],
  })
  driver.query({
    t: 'insert',
    into: POPULATION,
    cols: ['archetype', 'n'],
    q: select({
      cols: [col('archetype'), count()],
      from: table('entity'),
      where: and(
        notNull(col('archetype')),
        not(
          exists(
            select({
              cols: [lit(1)],
              from: table('tombstone'),
              where: eq(col('entity'), col('id', 'entity')),
            }),
          ),
        ),
      ),
      group: [col('archetype')],
    }),
  })
  driver.query({
    t: 'create table',
    name: MEMBERSHIP,
    cols: [{ name: 'component', type: 'text' }, {
      name: 'archetype',
      type: 'integer',
    }],
    keys: [{ pk: ['component', 'archetype'] }],
  })
  driver.query({
    t: 'insert',
    into: MEMBERSHIP,
    cols: ['component', 'archetype'],
    q: select({
      cols: [col('value', 'j'), col('entity', 'a')],
      from: table('archetype', 'a'),
      joins: [{
        how: 'cross',
        src: call('json_each', [col('tables', 'a')], 'j'),
      }],
    }),
  })
  driver.query({
    t: 'create trigger',
    name: `${MEMBERSHIP}_insert`,
    timing: 'after',
    event: 'insert',
    on: 'archetype',
    body: [{
      t: 'insert',
      into: MEMBERSHIP,
      cols: ['component', 'archetype'],
      q: select({
        cols: [col('value'), col('entity', 'new')],
        from: call('json_each', [col('tables', 'new')]),
      }),
    }],
  })
  driver.query({
    t: 'create trigger',
    name: `${MEMBERSHIP}_delete`,
    timing: 'after',
    event: 'delete',
    on: 'archetype',
    body: [{
      t: 'delete',
      from: MEMBERSHIP,
      where: eq(col('archetype'), col('entity', 'old')),
    }],
  })
  for (let event of ['insert', 'delete', 'update'] as const) {
    driver.query({
      t: 'create trigger',
      name: `${POPULATION}_${event}`,
      timing: 'after',
      event,
      on: 'entity',
      ...event == 'update'
        ? {
          of: ['archetype'],
          when: op('is not', col('archetype', 'old'), col('archetype', 'new')),
        }
        : {},
      body: [
        ...event != 'insert' ? [increment('old', -1)] : [],
        ...event != 'delete' ? [increment('new', 1)] : [],
      ] as Extract<Stmt, { t: 'insert' }>[],
    })
  }
  // Graves can be written before classification (or by SQL extensions).
  // Their physical presence, not the eventual descriptor, decides liveness.
  for (let event of ['insert', 'delete'] as const) {
    let which = event == 'insert' ? 'new' : 'old'
    let n = event == 'insert' ? -1 : 1
    driver.query({
      t: 'create trigger',
      name: `${POPULATION}_grave_${event}`,
      timing: 'after',
      event,
      on: 'tombstone',
      body: [{
        t: 'insert',
        into: POPULATION,
        cols: ['archetype', 'n'],
        q: select({
          cols: [col('archetype'), lit(n)],
          from: table('entity'),
          where: and(
            eq(col('id'), col('entity', which)),
            notNull(col('archetype')),
          ),
        }),
        upsert: [{
          on: [col('archetype')],
          set: { n: op('+', col('n'), lit(n)) },
        }],
      }],
    })
  }
}

export type Population = { value: string; n: number; tables: string[] }
/** Read buckets, never their owners. Tombstone sets are excluded exactly as
 * ordinary entity reads exclude graves. Unknown/old files decline the fast path. */
export let populations = (driver: Driver): Population[] | undefined => {
  if (!installed(driver)) return
  return driver.query(select({
    cols: [as(col('eid', 'e'), 'value'), col('n', 'p'), col('tables', 'a')],
    from: table(POPULATION, 'p'),
    // Population drives the join even when an eid ordering could tempt the
    // planner into scanning owners through entity's eid index.
    joins: [
      { how: 'cross', src: table('entity', 'e') },
      { how: 'cross', src: table('archetype', 'a') },
    ],
    where: and(
      gt(col('n', 'p'), lit(0)),
      eq(col('id', 'e'), col('archetype', 'p')),
      eq(col('entity', 'a'), col('archetype', 'p')),
    ),
    order: [col('eid', 'e')],
  })).map((r) => ({
    value: String(r.value),
    n: Number(r.n),
    tables: JSON.parse(String(r.tables)) as string[],
  }))
}

/** A pending raw patch may not have been classified yet. Then component
 * counts must read physical rows rather than an intermediate population. */
export let classified = (driver: Driver): boolean =>
  !driver.query(
    select({
      cols: [lit(1)],
      from: table('entity'),
      where: isNull(col('archetype')),
      limit: lit(1),
    }),
  ).length

/** A component's buckets are sought through a descriptor membership index;
 * unrelated descriptor diversity never adds work to a plain count. */
export let populationCount = (
  driver: Driver,
  component?: string,
): number | undefined => {
  if (!installed(driver)) return
  let p = table(POPULATION, 'p')
  let row = driver.query(
    select({
      cols: [as(fn('coalesce', fn('sum', col('n', 'p')), lit(0)), 'n')],
      from: component && component != 'entity' ? table(MEMBERSHIP, 'm') : p,
      ...component && component != 'entity'
        ? {
          joins: [{ how: 'cross' as const, src: p }],
          where: and(
            eq(col('component', 'm'), lit(component)),
            eq(col('archetype', 'p'), col('archetype', 'm')),
          ),
        }
        : {},
    }),
  )[0]
  return Number(row?.n ?? 0)
}

/** What a read's plans are sized by (@yaks/sql `Census`): a component's
 * counted population, once the file keeps populations, and the entity
 * table's largest id, one seek. Each is read only when a plan asks. */
export let census = (driver: Driver): Census => ({
  held: (comp) => populationCount(driver, comp),
  largest: () =>
    Number(
      driver.query(select({
        cols: [as(fn('max', col('id')), 'n')],
        from: table('entity'),
      }))[0]?.n ?? 0,
    ),
})

/** A presence-only entity policy selects whole buckets. Value-based policies
 * and component-specific visibility still need the ordinary scoped query. */
let visible = (vocab: Vocab, opts: BindOpts) => {
  if (Object.keys(opts.visibility?.components ?? {}).length) return
  let policy = opts.visibility?.entity
  let clauses = typeof policy == 'string'
    ? parse(policy).clauses
    : policy?.clauses ?? []
  let all: string[] = [], none: string[] = []
  for (let c of clauses) {
    if (
      c.kind != 'pred' || !bare(c) || c.op == '?' || c.not || c.where ||
      opts.extend?.some((e) => e.compile[c.kind]) ||
      c.path[0] == 'entity' || !vocab.comp(c.path[0]) ||
      vocab.comp(c.path[0])?.computed ||
      derivedOf(vocab, opts.derived)[c.path[0]] || opts.backed?.[c.path[0]]
    ) return
    let into = c.op == '!' ? all : none
    into.push(c.path[0])
  }
  return (tables: string[]) =>
    all.every((c) => tables.includes(c)) &&
    none.every((c) => !tables.includes(c))
}

// A clause that leaves a count's matches as they are: a declared component or
// property asked for with `?`, which carries it without filtering, and the
// row-shaping directives an aggregate ignores. An undeclared name is left to
// the compiler, which reads or refuses it.
let idle = (vocab: Vocab, c: And['clauses'][number]): boolean =>
  c.kind == 'order' || c.kind == 'limit' || c.kind == 'after' ||
  c.kind == 'pred' && c.op == '?' && !c.value && !c.not && !c.where &&
    !!vocab.comp(c.path[0]) &&
    (c.path.length == 1 ||
      c.path.length == 2 && !!vocab.prop(c.path[0], c.path[1]))

/** Only plain aggregates whose policy selects whole buckets use populations.
 * Shared by lazy activation and reads; value-scoped counts stay on SQL. */
export let cardinality = (
  parsed: And,
  vocab: Vocab,
  opts: BindOpts = {},
): {
  tally: boolean
  comp?: string
  visible: (tables: string[]) => boolean
} | undefined => {
  let cs = parsed.clauses
  let accepts = visible(vocab, opts)
  if (
    !vocab.comp('archetype') || !accepts || opts.eids ||
    opts.absent?.length ||
    opts.extend?.some((e) => cs.some((c) => e.compile[c.kind]))
  ) return
  let tally = cs.length == 1 && cs[0].kind == 'tally' &&
    cs[0].path.join('.') == 'entity.archetype'
  let count = cs.some((c) => c.kind == 'count')
  let filters = cs.filter((c) => c.kind != 'count' && !idle(vocab, c))
  let f = filters[0]
  let comp = filters.length == 1 && f.kind == 'pred' && !f.not &&
      f.op == '!' && !f.value && f.path.length == 1
    ? f.path[0]
    : undefined
  let plain = count && (!filters.length || !!comp)
  if (
    !(tally || plain) || comp && (!vocab.comp(comp) || opts.backed?.[comp] ||
        vocab.comp(comp)?.computed || derivedOf(vocab, opts.derived)[comp])
  ) return
  return { tally, comp, visible: accepts }
}
