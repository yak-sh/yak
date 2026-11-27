// Exact entity populations by archetype. One migration reads existing owners;
// afterwards entity triggers move only the old and new buckets, in the same
// transaction as the entity. Ordinary component property writes do no work.
import { type And, bare, type Clause, parse } from '@yaks/query/core'
import type { Vocab } from '@yaks/vocab'
import { type Filter, filter } from '@yaks/match'
import {
  and,
  as,
  type BindOpts,
  call,
  catalogue,
  type Census,
  col,
  count,
  type CreateTable,
  type CreateTrigger,
  type Delete,
  derivedOf,
  type Driver,
  entryIs,
  eq,
  exists,
  type Expr,
  fn,
  gt,
  type Insert,
  isNull,
  le,
  lit,
  not,
  notNull,
  op,
  revision,
  select,
  type Source,
  type Stmt,
  table,
} from '@yaks/sql'
import { descriptor } from './catalog.ts'

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

/** The triggers on the spine that keep each archetype's count: one more for
 * an entity born or moved into it, one fewer for one dropped or moved out. */
export let tallying: CreateTrigger[] = (['insert', 'delete', 'update'] as const)
  .map((event) => ({
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
  }))

// Which component tables each populated archetype holds: an archetype's
// rows stand while a live entity wears it, and go when its last one leaves.
// An archetype is never forgotten, so a store whose entities gain and lose
// components keeps every set they ever wore: the directory held 674 for its
// 404 apps, and a count of apps read each of them and its empty population
// (T-4230). A count reads only the archetypes worn now.
//
// Archetype `id`'s rows, one for each of the tables a descriptor names,
// read from `from`.
let enter = (
  id: Expr,
  tables: Expr,
  where: Expr,
  ...from: Source[]
): Insert => {
  let [first, ...rest] = [...from, call('json_each', [tables], 'j')]
  return {
    t: 'insert',
    or: 'ignore',
    into: MEMBERSHIP,
    cols: ['component', 'archetype'],
    q: select({
      cols: [col('value', 'j'), id],
      from: first,
      joins: rest.map((src) => ({ how: 'cross' as const, src })),
      where,
    }),
  }
}
let leave = (id: Expr): Delete => ({
  t: 'delete',
  from: MEMBERSHIP,
  where: eq(col('archetype'), id),
})
// The rows of the archetype a population row counts, from its descriptor.
let wearing = (id: Expr) =>
  enter(
    id,
    col('tables', 'a'),
    eq(col('entity', 'a'), id),
    table('archetype', 'a'),
  )
let membership: CreateTrigger[] = [
  // A descriptor written after the first entity to wear it.
  {
    t: 'create trigger',
    name: `${MEMBERSHIP}_described`,
    timing: 'after',
    event: 'insert',
    on: 'archetype',
    body: [enter(
      col('entity', 'new'),
      col('tables', 'new'),
      exists(select({
        cols: [lit(1)],
        from: table(POPULATION),
        where: and(
          eq(col('archetype'), col('entity', 'new')),
          gt(col('n'), lit(0)),
        ),
      })),
    )],
  },
  {
    t: 'create trigger',
    name: `${MEMBERSHIP}_undescribed`,
    timing: 'after',
    event: 'delete',
    on: 'archetype',
    body: [leave(col('entity', 'old'))],
  },
  {
    t: 'create trigger',
    name: `${MEMBERSHIP}_worn`,
    timing: 'after',
    event: 'insert',
    on: POPULATION,
    when: gt(col('n', 'new'), lit(0)),
    body: [wearing(col('archetype', 'new'))],
  },
  {
    t: 'create trigger',
    name: `${MEMBERSHIP}_reworn`,
    timing: 'after',
    event: 'update',
    of: ['n'],
    on: POPULATION,
    when: and(le(col('n', 'old'), lit(0)), gt(col('n', 'new'), lit(0))),
    body: [wearing(col('archetype', 'new'))],
  },
  {
    t: 'create trigger',
    name: `${MEMBERSHIP}_shed`,
    timing: 'after',
    event: 'update',
    of: ['n'],
    on: POPULATION,
    when: and(gt(col('n', 'old'), lit(0)), le(col('n', 'new'), lit(0))),
    body: [leave(col('archetype', 'new'))],
  },
]
// What membership was before it followed populations: every archetype ever
// described, kept by these two.
let LEGACY = [`${MEMBERSHIP}_insert`, `${MEMBERSHIP}_delete`]

// Graves can be written before classification (or by SQL extensions).
// Their physical presence, not the eventual descriptor, decides liveness.
let burying: CreateTrigger[] = (['insert', 'delete'] as const).map((event) => {
  let which = event == 'insert' ? 'new' : 'old'
  return {
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
        cols: [col('archetype'), lit(event == 'insert' ? -1 : 1)],
        from: table('entity'),
        where: and(
          eq(col('id'), col('entity', which)),
          notNull(col('archetype')),
        ),
      }),
      upsert: [{
        on: [col('archetype')],
        set: { n: op('+', col('n'), lit(event == 'insert' ? -1 : 1)) },
      }],
    }],
  }
})

let COUNTS: CreateTable = {
  t: 'create table',
  name: POPULATION,
  cols: [{ name: 'archetype', type: 'integer', pk: true }, {
    name: 'n',
    type: 'integer',
    notNull: true,
  }],
}
let MEMBERS: CreateTable = {
  t: 'create table',
  name: MEMBERSHIP,
  cols: [{ name: 'component', type: 'text' }, {
    name: 'archetype',
    type: 'integer',
  }],
  keys: [{ pk: ['component', 'archetype'] }],
}

// Everything the counts are made of. Each trigger moves them with the rows,
// and the counts are only true while every one stands: a table made again
// drops the triggers on it (./ddl.ts `refit`), and a spine respun before
// T-164366 dropped `tallying`, so the platform's directory went on counting
// each deploy deleted and none created. The membership is made again from
// the counts alone, without reading an entity.
let COUNTING: Stmt[] = [COUNTS, ...tallying, ...burying]
let MEMBERSHIPS: Stmt[] = [MEMBERS, ...membership]
let PARTS = [...COUNTING, ...MEMBERSHIPS]

/** Whether the file keeps counts, and every trigger that keeps them true:
 * what an answer read from them asks. It reads the file's whole schema, once
 * per schema revision (@yaks/sql `catalogue`). */
export let installed = (driver: Driver): boolean => standing(driver, PARTS)
let standing = (driver: Driver, parts: Stmt[]) => {
  let held = new Set(catalogue(driver).map((o) => o.name))
  return parts.every((s) => held.has((s as { name: string }).name))
}

// Whether the file keeps counts at all, one look at their table, once while
// the schema stands: what a plan is sized by asks. A count gone stale sizes a
// plan badly and answers nothing, and the next answer read from the counts
// seeds them anew ({@link population}).
let looked = new WeakMap<object, { at: number; kept: boolean }>()
let kept = (driver: Driver): boolean => {
  let at = revision(driver, 'schema'), on = driver.connection ?? driver
  let held = looked.get(on)
  if (held?.at !== at) {
    let rows = driver.query({
      t: 'pragma',
      name: 'table_info',
      arg: POPULATION,
    })
    looked.set(on, held = { at, kept: rows.length > 0 })
  }
  return held.kept
}

// Drop `parts`, and the names before them: the triggers first, since a
// table dropped takes the triggers on it along.
let clear = (driver: Driver, parts: Stmt[], legacy: string[] = []) => {
  let named = (s: Stmt) => (s as { name: string }).name
  let triggers = parts.filter((s) => s.t == 'create trigger').map(named)
  let tables = parts.filter((s) => s.t == 'create table').map(named)
  for (let name of [...legacy, ...triggers]) {
    driver.query({ t: 'drop', kind: 'trigger', name, ifExists: true })
  }
  for (let name of tables) {
    driver.query({ t: 'drop', kind: 'table', name, ifExists: true })
  }
}

/** Install once, after the entity schema and its archetype backfill stand.
 * Seeding and the triggers commit together; another opener sees both or none.
 * Counts missing any part are not trusted: what is left of them goes, and they
 * are seeded anew from the rows. A membership missing a part is made again
 * from the counts that stand. */
export let population = (driver: Driver): void => {
  if (installed(driver)) return
  if (!standing(driver, COUNTING)) {
    clear(driver, PARTS, LEGACY)
    driver.query(COUNTS)
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
    for (let t of [...tallying, ...burying]) driver.query(t)
  }
  clear(driver, MEMBERSHIPS, LEGACY)
  driver.query(MEMBERS)
  driver.query(
    enter(
      col('archetype', 'p'),
      col('tables', 'a'),
      and(
        gt(col('n', 'p'), lit(0)),
        eq(col('entity', 'a'), col('archetype', 'p')),
      ),
      table(POPULATION, 'p'),
      table('archetype', 'a'),
    ),
  )
  for (let t of membership) driver.query(t)
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
    tables: [...descriptor(driver, String(r.tables)).tables],
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
  kept?: Presence,
): number | undefined =>
  installed(driver) ? counting(driver, component, kept) : undefined
let counting = (
  driver: Driver,
  component?: string,
  kept?: Presence,
): number => {
  let p = table(POPULATION, 'p')
  let member = (name: string) =>
    entryIs(col('component', 'm'), driver.stored?.v, name)
  let bucket = eq(col('archetype', 'p'), col('archetype', 'm'))
  let wearing = (name: string) =>
    exists(select({
      cols: [lit(1)],
      from: table(MEMBERSHIP, 'm'),
      where: and(member(name), bucket),
    }))
  let by = component && component != 'entity' ? component : undefined
  let row = driver.query(
    select({
      cols: [as(fn('coalesce', fn('sum', col('n', 'p')), lit(0)), 'n')],
      from: by ? table(MEMBERSHIP, 'm') : p,
      joins: by ? [{ how: 'cross' as const, src: p }] : [],
      where: and(
        ...by ? [member(by), bucket] : [],
        ...(kept?.all ?? []).filter((c) => c != by).map(wearing),
        ...(kept?.none ?? []).map((c) => not(wearing(c))),
      ),
    }),
  )[0]
  return Number(row?.n ?? 0)
}

// What the census has read, while the rows it read stand (@yaks/sql
// `revision`): the reads of one summary share a revision, and ask once.
type Counted = {
  at: number
  held: Map<string, number | undefined>
  looked: Map<string, boolean>
  numbered: Map<string, boolean>
  largest?: number
}
let counts = new WeakMap<Driver, Counted>()
let counted = (driver: Driver): Counted => {
  let at = revision(driver, 'data')
  let held = counts.get(driver)
  if (held?.at != at) {
    counts.set(
      driver,
      held = { at, held: new Map(), looked: new Map(), numbered: new Map() },
    )
  }
  return held
}

// Whether any live entity holding `comp` has a number: a seek of the number
// index (`entity(archetype, num)`) for each archetype a live entity wears that
// holds it, and one for the entities no archetype describes yet, which may
// hold it too.
let numbering = (driver: Driver, comp: string): boolean =>
  driver.query(select({
      cols: [lit(1)],
      from: table(MEMBERSHIP, 'm'),
      joins: [{ how: 'cross', src: table('entity', 'e') }],
      where: and(
        entryIs(col('component', 'm'), driver.stored?.v, comp),
        eq(col('archetype', 'e'), col('archetype', 'm')),
        notNull(col('num', 'e')),
      ),
      limit: lit(1),
    })).length > 0 ||
  driver.query(select({
      cols: [lit(1)],
      from: table('entity'),
      where: and(isNull(col('archetype')), notNull(col('num'))),
      limit: lit(1),
    })).length > 0

/** What a read's plans are sized by (@yaks/sql `Census`): a component's
 * counted population, once the file keeps populations, the entity table's
 * largest id, one seek, whether a component's table holds more than so
 * many rows, a bounded look, and whether any entity holding a component has
 * a number, a seek per archetype holding it. Each is read only when a plan
 * asks, and once while the rows it read stand. */
export let census = (driver: Driver): Census => ({
  held: (comp) => {
    let at = counted(driver)
    if (!kept(driver)) return
    if (!at.held.has(comp)) at.held.set(comp, counting(driver, comp))
    return at.held.get(comp)
  },
  largest: () =>
    counted(driver).largest ??= Number(
      driver.query(select({
        cols: [as(fn('max', col('id')), 'n')],
        from: table('entity'),
      }))[0]?.n ?? 0,
    ),
  exceeds: (comp, n) => {
    let { looked } = counted(driver), key = `${n} ${comp}`
    let more = looked.get(key)
    if (more == null) {
      more = driver.query(select({
        cols: [lit(1)],
        from: table(comp),
        limit: lit(1),
        offset: lit(n),
      })).length > 0
      looked.set(key, more)
    }
    return more
  },
  numbered: (comp) => {
    let at = counted(driver)
    if (!kept(driver)) return
    if (!at.numbered.has(comp)) at.numbered.set(comp, numbering(driver, comp))
    return at.numbered.get(comp)
  },
  // A count gone stale chooses a road badly and answers nothing.
  counts: () => {
    if (!kept(driver)) return
    return { population: POPULATION, membership: MEMBERSHIP }
  },
})

type Presence = { all: string[]; none: string[] }

let presence = (
  vocab: Vocab,
  opts: BindOpts,
  clauses: Clause[],
): Presence | undefined => {
  let all: string[] = [], none: string[] = []
  for (let c of clauses) {
    if (
      c.kind != 'pred' || !bare(c) || c.op == '?' || c.where ||
      opts.extend?.some((e) => e.compile[c.kind]) ||
      !vocab.comp(c.path[0]) ||
      vocab.comp(c.path[0])?.computed ||
      derivedOf(vocab, opts.derived)[c.path[0]] || opts.backed?.[c.path[0]]
    ) return
    let present = c.op == '!' && !c.not
    // Every live row already has its entity spine.
    if (c.path[0] == 'entity') {
      if (present) continue
      return
    }
    let into = present ? all : none
    into.push(c.path[0])
  }
  return { all, none }
}

/** A presence-only entity policy selects whole buckets. */
let visible = (vocab: Vocab, opts: BindOpts) => {
  if (Object.keys(opts.visibility?.components ?? {}).length) return
  let policy = opts.visibility?.entity
  return presence(
    vocab,
    opts,
    typeof policy == 'string' ? parse(policy).clauses : policy?.clauses ?? [],
  )
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
  presence?: Presence
  archetype?: Filter
} | undefined => {
  let cs = parsed.clauses
  let accepts = visible(vocab, opts)
  if (
    !vocab.comp('archetype') || !accepts || opts.eids ||
    opts.extend?.some((e) => cs.some((c) => e.compile[c.kind]))
  ) return
  let tally = cs.length == 1 && cs[0].kind == 'tally' &&
    cs[0].path.join('.') == 'entity.archetype'
  let count = cs.some((c) => c.kind == 'count')
  let filters = cs.filter((c) => c.kind != 'count' && !idle(vocab, c))
  let metadata = !opts.backed?.entity &&
    vocab.prop('entity', 'archetype')?.ref == 'archetype' &&
    !vocab.prop('entity', 'archetype')?.computed &&
    !derivedOf(vocab, opts.derived)['entity.archetype'] &&
    !opts.visibility?.entity && filters.length > 0 &&
    filters.every((c) =>
      c.kind == 'pred' && !c.not && !c.where &&
      c.path.join('.') == 'entity.archetype' &&
      (c.op == '!' && !c.value || ['=', '!='].includes(c.op) &&
          (!c.value || c.value.kind == 'scalar' && c.value.raw == ''))
    )
  let parts = presence(vocab, opts, filters)
  if (!(tally || count && (parts || metadata))) return
  let all = [...accepts.all, ...parts?.all ?? []]
  let none = [...accepts.none, ...parts?.none ?? []]
  return {
    tally,
    comp: all[0],
    visible: (tables) =>
      all.every((c) => tables.includes(c)) &&
      none.every((c) => !tables.includes(c)),
    ...parts || tally ? { presence: { all, none } } : {},
    ...metadata
      ? { archetype: filter({ kind: 'and', clauses: filters }, vocab) }
      : {},
  }
}
