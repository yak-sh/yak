// Query projection, name resolution and caller views over committed storage.
// A read-only graph and the writable graph use the same read pipeline.
import { and, eq, list, mask, parse, want } from '@yaks/query/core'
import { matcher, rows as matchRows } from '@yaks/match'
import type { Vocab } from '@yaks/vocab'
import { type Context, context, during, live, peek, scope } from '@yaks/trace'
import { after, each } from '@yaks/fp'
import type { Bundle, Eid } from './bundle.ts'
import type {
  Query,
  ReadOpts,
  ReadTx,
  Row,
  Storage,
  Visibility,
} from './storage.ts'
import { detached } from './storage.ts'
import type { Plugin, ReadView } from './plugin.ts'
import type { Graph, Options } from './graph.ts'
import { Refused } from './errors.ts'
import { addressing } from './said.ts'
import { flat, named, only, projection } from './projection.ts'

/** The committed storage a reader needs, without any mutation methods. */
export type ReadStorage = Pick<Storage, 'read' | 'rows' | 'get'>
export type Reader =
  & Pick<
    Graph,
    | 'read'
    | 'rows'
    | 'get'
    | 'address'
    | 'ask'
    | 'answer'
    | 'view'
    | 'rewrites'
    | 'scope'
  >
  & {
    use: (plugin: Plugin) => void
  }

/** Retain the caller's activity context across asynchronous read hooks. */
export let continuing = <A, B>(
  value: A | Promise<A>,
  run: (value: A) => B,
): B | Promise<Awaited<B>> => {
  let at = context()
  return after(value, at ? (value) => scope(at, () => run(value)) : run)
}

/** Read through the graph's projection and addressing rules. An owning host
 * can supply its traced committed transaction; otherwise only reads are
 * exposed to plugins. Admission, rules, writes and effects never run here. */
export let reader = (opts: {
  storage: ReadStorage
  vocab: Vocab
  plugins?: Plugin[]
  outside?: () => ReadTx
}): Reader => {
  let { storage, vocab } = opts
  let plugins = [...opts.plugins ?? []]
  let askHooks = plugins.filter((p) => p.ask)
  let answerHooks = plugins.filter((p) => p.answer)
  let viewHooks = plugins.filter((p) => p.view)
  const emptyReadOpts: ReadOpts = {}
  let outsideRead = opts.outside ?? (() => ({
    read: (q, o, comps) => storage.read(q, o, comps),
    get: (ids, comps, o) => storage.get(ids, comps, o),
  }))
  let scoped = (readOpts: ReadOpts = {}): ReadOpts => {
    let visibility = readOpts.visibility
    let combine = (
      a: Query | undefined,
      b: Query | undefined,
    ): Query | undefined =>
      !a ? b : !b ? a : and(
        typeof a == 'string' ? parse(a) : a,
        typeof b == 'string' ? parse(b) : b,
      )
    for (let p of plugins) {
      let more = p.scope?.({ opts: readOpts, tx: outsideRead(), vocab })
      if (!more) continue
      let components: NonNullable<Visibility['components']> = {
        ...visibility?.components,
      }
      for (let [name, q] of Object.entries(more.components ?? {})) {
        components[name] = combine(components[name], q)!
      }
      visibility = {
        entity: combine(visibility?.entity, more.entity),
        components,
      }
    }
    return visibility ? { ...readOpts, visibility } : readOpts
  }
  let readContext = (plugin: Plugin, options: ReadOpts = {}) => {
    let authoritative = outsideRead()
    if (plugin.scope) return { opts: options, tx: authoritative, vocab }
    let limited = (extra: ReadOpts = {}) =>
      scoped({
        ...options,
        ...extra,
        person: options.person,
        administrative: options.administrative,
      })
    let read: ReadTx['read'] = (q, o, comps) =>
      authoritative.read(q, limited(o), comps)
    let tx: ReadTx = {
      read,
      whole: read,
      get: (ids, comps, o) => authoritative.get(ids, comps, limited(o)),
    }
    return { opts: options, tx, vocab }
  }
  // The same convenience a tool's arguments get (tool.ts `addressed`), applied
  // to a query string: wherever the query names an entity, an id a person can
  // type is resolved to the eid the store keys rows by (said.ts).
  let aim = addressing(vocab)

  // What a caller asks before reading by id: every plugin that knows how a
  // name becomes an eid, asked in turn, each about the ids no earlier plugin
  // resolved. It runs outside any transaction — the caller is asking before it
  // does anything. An id some plugin recognised and none resolved names
  // nothing, and is refused here, once for every door: otherwise the caller
  // reads it back as an eid and a write mints an entity whose eid is `T-998`.
  let address = (
    ids: string[],
    kind?: string,
  ): Map<string, Eid> | Promise<Map<string, Eid>> => {
    let asks = plugins.flatMap((p) => p.address ?? [])
    if (!asks.length || !ids.length) return new Map<string, Eid>()
    let outside = outsideRead()
    let asked = each(
      asks,
      new Map<string, Eid | null>(),
      (at, ask) =>
        continuing(
          ask(outside, ids.filter((id) => at.get(id) == null), kind),
          (more) => new Map([...at, ...more]),
        ),
    )
    return continuing(asked, (at) => {
      let found = new Map<string, Eid>()
      let nothing: string[] = []
      for (let [id, eid] of at) {
        eid == null ? nothing.push(id) : found.set(id, eid)
      }
      if (nothing.length) {
        throw new Refused(
          `${nothing.join(', ')} ${nothing.length == 1 ? 'names' : 'name'} ` +
            'nothing',
        )
      }
      return found
    })
  }

  let ask = (query: Query, readOpts?: ReadOpts): Query | Promise<Query> =>
    continuing(aim(query, address), (q) => {
      if (readOpts?.native || !askHooks.length) return q
      let hooks = askHooks.filter((p) =>
        !p.reads || p.reads(readOpts ?? emptyReadOpts)
      )
      if (!hooks.length) return q
      let ast = typeof q == 'string' ? parse(q) : q
      return continuing(
        each(hooks, ast, (at, p) => p.ask!(readContext(p, readOpts), at)),
        (out) => out === ast ? q : out,
      )
    })

  let answer = (
    bundles: Bundle[],
    readOpts?: ReadOpts,
    owner?: Plugin,
    mandatory = false,
  ) => {
    if (!answerHooks.length) return bundles
    let hooks = answerHooks.filter((p) =>
      (p != owner || p.scope) && (!readOpts?.native || p.scope) &&
      (!mandatory || p.scope) &&
      (!p.reads || p.reads(readOpts ?? emptyReadOpts))
    ).sort((a, b) => Number(!!b.scope) - Number(!!a.scope))
    if (!hooks.length) return bundles
    return each(
      hooks,
      bundles,
      (at, p) => p.answer!(readContext(p, readOpts), at),
    )
  }

  let rewrites = (readOpts?: ReadOpts) =>
    answerHooks.some((p) =>
      p.scope && (!p.reads || p.reads(readOpts ?? emptyReadOpts))
    ) ||
    !readOpts?.native && (
        askHooks.some((p) => !p.reads || p.reads(readOpts ?? emptyReadOpts)) ||
        answerHooks.some((p) =>
          !p.reads || p.reads(readOpts ?? emptyReadOpts)
        ) ||
        viewHooks.some((p) => !p.reads || p.reads(readOpts ?? emptyReadOpts))
      )

  type Viewed = { view: ReadView; owner: Plugin }
  let viewed = (query: Query, readOpts?: ReadOpts) => {
    if (readOpts?.native || !viewHooks.length) return null
    let hooks = viewHooks.filter((p) =>
      !p.reads || p.reads(readOpts ?? emptyReadOpts)
    )
    if (!hooks.length) return null
    return continuing(aim(query, address), (q) => {
      let original = typeof q == 'string' ? parse(q) : q
      return continuing(
        each(
          hooks,
          null as Viewed | null,
          (at, p) =>
            at ??
              continuing(
                p.view!(readContext(p, readOpts), original),
                (v) => v ? { view: v, owner: p } : null,
              ),
        ),
        (out) => out ? { ...out, view: { ...out.view, original } } : null,
      )
    })
  }
  let view = (query: Query, readOpts?: ReadOpts) =>
    continuing(viewed(query, readOpts), (out) => out?.view ?? null)

  // Candidates must reach the answer as whole bundles, before any final
  // shaping. Applying a caller's limit in storage could discard the only
  // entity whose reconstructed values pass its filter.
  let shaped = new Set([
    'fields',
    'every',
    'count',
    'distinct',
    'tally',
    'order',
    'limit',
    'after',
  ])
  let candidates = (v: ReadView, readOpts?: ReadOpts) =>
    continuing(
      storage.read({
        ...v.query,
        clauses: v.query.clauses.filter((c) => !shaped.has(c.kind)),
      }, { ...readOpts, native: true }),
      (rows) =>
        continuing(v.expand ? v.expand(rows) : rows, (expanded) =>
          continuing(answer(expanded, readOpts, undefined, true), v.answer)),
    )

  // The owning view already reconstructed its answer. Other plugins finish
  // the caller's projected bundles, just as they finish canonical reads.
  let readView = ({ view: v, owner }: Viewed, readOpts?: ReadOpts) =>
    continuing(candidates(v, readOpts), (bundles) => {
      let p = projection(v.vocab, v.original)
      let out = p
        ? flat(p.fold(matchRows(p.query, v.vocab, readOpts)(bundles)))
        : matcher(v.original, v.vocab, readOpts)(bundles).map(
          only(named(v.vocab, v.original)),
        )
      return answer(out, readOpts, owner)
    })

  let getTranslated = (eids: Eid[], comps?: string[], readOpts?: ReadOpts) => {
    if (
      readOpts?.native || !askHooks.length && !answerHooks.length ||
      !rewrites(readOpts)
    ) {
      return storage.get(eids, comps, readOpts)
    }
    if (!comps?.length) {
      return continuing(
        storage.get(eids, comps, readOpts),
        (out) => answer(out, readOpts),
      )
    }
    return continuing(ask(and(...comps.map(want)), readOpts), (q) => {
      let names = named(vocab, q, true)
      return continuing(
        storage.get(eids, names ? [...names] : undefined, readOpts),
        (out) => answer(out, readOpts),
      )
    })
  }

  let get = (eids: Eid[], comps?: string[], readOpts?: ReadOpts) => {
    if (!viewHooks.length || readOpts?.native || comps?.length === 0) {
      return getTranslated(eids, comps, readOpts)
    }
    let q = and(eq('entity.eid', list(...eids)), ...comps?.map(want) ?? [])
    return continuing(
      viewed(q, readOpts),
      (out) =>
        out
          ? continuing(
            storage.get(eids, undefined, readOpts),
            (bundles) =>
              continuing(
                continuing(
                  out.view.expand ? out.view.expand(bundles) : bundles,
                  (expanded) =>
                    continuing(
                      answer(expanded, readOpts, undefined, true),
                      out.view.answer,
                    ),
                ),
                (rows) =>
                  answer(
                    rows.filter((b) => eids.includes(b.entity.eid)).map(
                      only(comps ? new Set(comps) : null),
                    ),
                    readOpts,
                    out.owner,
                  ),
              ),
          )
          : getTranslated(eids, comps, readOpts),
    )
  }

  let readStored = (q: Query, readOpts?: ReadOpts, nested = false) => {
    let p = projection(vocab, q)
    if (p) {
      return continuing(
        storage.rows(p.query, readOpts),
        (rows) => flat(p.fold(rows)),
      )
    }
    let names = named(vocab, q, nested)
    return continuing(
      storage.read(q, readOpts, names ? [...names] : undefined),
      (rows) => rows.map(only(names)),
    )
  }

  let readPlain = (query: Query, readOpts?: ReadOpts) =>
    continuing(
      aim(query, address),
      (q) => readStored(q, readOpts, !!readOpts?.native),
    )

  let readTranslated = (
    query: Query,
    readOpts?: ReadOpts,
  ): Bundle[] | Promise<Bundle[]> => {
    if (viewHooks.length && !readOpts?.native) {
      return continuing(
        viewed(query, readOpts),
        (v) => v ? readView(v, readOpts) : readRenamed(query, readOpts),
      )
    }
    return readRenamed(query, readOpts)
  }
  let readRenamed = (query: Query, readOpts?: ReadOpts) => {
    if (!rewrites(readOpts)) return readPlain(query, readOpts)
    return continuing(
      ask(query, readOpts),
      (q) =>
        continuing(
          readStored(q, readOpts, !!readOpts?.native || q !== query),
          (rows) => answer(rows, readOpts),
        ),
    )
  }
  let read = askHooks.length || answerHooks.length || viewHooks.length
    ? readTranslated
    : readPlain

  let rowsPlain = (query: Query, readOpts?: ReadOpts) =>
    continuing(aim(query, address), (q) => storage.rows(q, readOpts))

  let rowsTranslated = (
    query: Query,
    readOpts?: ReadOpts,
  ): Row[] | Promise<Row[]> => {
    if (viewHooks.length && !readOpts?.native) {
      return continuing(
        view(query, readOpts),
        (v) =>
          v
            ? continuing(
              candidates(v, readOpts),
              matchRows(v.original, v.vocab, readOpts),
            )
            : rowsRenamed(query, readOpts),
      )
    }
    return rowsRenamed(query, readOpts)
  }
  let rowsRenamed = (query: Query, readOpts?: ReadOpts) => {
    if (!rewrites(readOpts)) return rowsPlain(query, readOpts)
    return continuing(ask(query, readOpts), (q) => {
      if (q === query) return storage.rows(q, readOpts)
      let before = typeof query == 'string' ? parse(query) : query
      let rewritten = typeof q == 'string' ? parse(q) : q
      let old = before.clauses.find((c) => c.kind == 'fields')
      let current = rewritten.clauses.find((c) => c.kind == 'fields')
      if (!old || !current) return storage.rows(q, readOpts)
      let columns = current.fields.map((f, i) => [
        f.path.join('.'),
        old.fields[i]?.path.join('.') ?? f.path.join('.'),
      ])
      return continuing(storage.rows(q, readOpts), rename)
      function rename(rows: Row[]): Row[] {
        return rows.map((row) => {
          let out = { ...row }
          for (let [from, to] of columns) {
            if (from != to && Object.hasOwn(row, from)) {
              delete out[from]
              out[to] = row[from]
            }
          }
          return out
        })
      }
    })
  }
  let rows = askHooks.length || answerHooks.length || viewHooks.length
    ? rowsTranslated
    : rowsPlain

  return {
    address,
    scope: scoped,
    ask: (q, o) => ask(q, scoped(o)),
    answer,
    view,
    rewrites,
    read: (q, o) => read(q, scoped(o)),
    rows: (q, o) => rows(q, o === undefined ? scoped() : scoped(o)),
    get: (ids, comps, o) => get(ids, comps, scoped(o)),
    use: (plugin) => {
      plugins.push(plugin)
      if (plugin.ask) askHooks.push(plugin)
      if (plugin.answer) answerHooks.push(plugin)
      if (plugin.view) viewHooks.push(plugin)
      if (plugin.ask || plugin.answer || plugin.view) {
        read = readTranslated
        rows = rowsTranslated
      }
    },
  }
}

// Retained reads and writes restore the operation whose transaction they hold.
export let retained = <T extends ReadTx>(tx: T, owner: () => Context): T =>
  Object.fromEntries(
    Object.entries(tx).map((
      [name, method],
    ) => [
      name,
      typeof method != 'function' ? method : (...args: unknown[]) => {
        let at = owner()
        let inside = context(at.parent)
        return scope(
          inside?.channel == at.channel && live(at) ? inside : at,
          () => Reflect.apply(method, tx, args),
        )
      },
    ]),
  ) as T

// The query line a span keeps: masked, bounded, and none for a built tree.
let line = (q: Query) =>
  typeof q == 'string' ? mask(q).slice(0, 512) : undefined

/** Trace the shared read pipeline at its graph boundary. */
export let queries = (
  owner: () => object,
  reads: Pick<Reader, 'read' | 'rows' | 'get'>,
): Pick<Graph, 'read' | 'rows' | 'get'> => {
  let { read, rows, get } = reads
  return {
    read: (query, readOpts) => {
      let c = peek(owner())
      if (!c) return read(query, readOpts)
      return during(
        c.begin({
          kind: 'query',
          name: 'read',
          package: '@yaks/graph',
          parent: readOpts?.parent,
          query: line(query),
        }),
        () => read(query, readOpts),
        'ok',
        (out) => ({ rows: out.length }),
      )
    },
    rows: (query, readOpts) => {
      let c = peek(owner())
      if (!c) {
        return rows(query, readOpts)
      }
      return during(
        c.begin({
          kind: 'query',
          name: 'rows',
          package: '@yaks/graph',
          parent: readOpts?.parent,
          query: line(query),
        }),
        () => rows(query, readOpts),
        'ok',
        (out) => ({ rows: out.length }),
      )
    },
    get: (eids, comps, readOpts) => {
      let c = peek(owner())
      if (!c) return get(eids, comps, readOpts)
      return during(
        c.begin({
          kind: 'get',
          name: 'get',
          package: '@yaks/graph',
          parent: readOpts?.parent,
        }),
        () => get(eids, comps, readOpts),
        'ok',
        (out) => ({ input: eids.length, rows: out.length }),
      )
    },
  }
}

/** A graph over committed storage: reads keep every registered hook, while
 * attempted writes refuse before preparation, admission or storage callbacks. */
export let graph = (opts: Options): Graph => {
  let refuse = (): never => {
    throw new Refused('a read-only graph cannot write')
  }
  let storage: Storage = { ...opts.storage, install: refuse, tx: refuse }
  let plugins = [...opts.plugins ?? []]
  let outside = detached(storage)
  let reads = reader({
    storage,
    vocab: opts.vocab,
    plugins,
    outside: () => {
      let at = context()
      return at ? retained(outside, () => at) : outside
    },
  })
  let g: Graph = {
    ...reads,
    ...queries(() => g, reads),
    vocab: opts.vocab,
    storage,
    outside,
    plugins,
    worn: (comp, prop) => storage.worn?.(comp, prop) ?? false,
    use: (plugin) => {
      plugins.push(plugin)
      reads.use(plugin)
      return g
    },
    apply: refuse,
    admit: refuse,
    install: refuse,
  }
  return g
}

export { type Agg, aggregate, type Reduced, reduced } from './aggregate.ts'
export {
  type Coverage,
  flat,
  named,
  only,
  project,
  type Projected,
  type Projection,
  projection,
} from './projection.ts'
export { transient, type TransientFrame, type Transients } from './transient.ts'

export { doomed } from './cascade.ts'

export { addressing } from './said.ts'
