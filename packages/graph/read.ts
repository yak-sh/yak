// Query projection, name resolution and caller views over committed storage.
// A read-only graph and the writable graph use the same read pipeline.
import { and, eq, list, parse, want } from '@yaks/query'
import { matcher, rows as matchRows } from '@yaks/match'
import type { Vocab } from '@yaks/vocab'
import { context, scope } from '@yaks/trace'
import { after, each } from '@yaks/fp'
import type { Bundle, Eid } from './bundle.ts'
import type { Query, ReadOpts, ReadTx, Row, Storage } from './storage.ts'
import type { Plugin, ReadView } from './plugin.ts'
import type { Graph } from './graph.ts'
import { Refused } from './admit.ts'
import { addressing } from './said.ts'
import { flat, named, only, projection } from './projection.ts'

/** The committed storage a reader needs, without any mutation methods. */
export type ReadStorage = Pick<Storage, 'read' | 'rows' | 'get'>
export type Reader =
  & Pick<
    Graph,
    'read' | 'rows' | 'get' | 'address' | 'ask' | 'answer' | 'view' | 'rewrites'
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
 * exposed to plugins. No admission, rules, writes or effects are loaded. */
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
    read: (q, o) => storage.read(q, o),
    get: (ids, comps) => storage.get(ids, comps),
  }))
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
      let ctx = {
        opts: readOpts ?? emptyReadOpts,
        tx: outsideRead(),
        vocab,
      }
      return continuing(
        each(hooks, ast, (at, p) => p.ask!(ctx, at)),
        (out) => out === ast ? q : out,
      )
    })

  let answer = (bundles: Bundle[], readOpts?: ReadOpts) => {
    if (readOpts?.native || !answerHooks.length) return bundles
    let hooks = answerHooks.filter((p) =>
      !p.reads || p.reads(readOpts ?? emptyReadOpts)
    )
    if (!hooks.length) return bundles
    let ctx = { opts: readOpts ?? emptyReadOpts, tx: outsideRead(), vocab }
    return each(hooks, bundles, (at, p) => p.answer!(ctx, at))
  }

  let rewrites = (readOpts?: ReadOpts) =>
    !readOpts?.native && (
      askHooks.some((p) => !p.reads || p.reads(readOpts ?? emptyReadOpts)) ||
      answerHooks.some((p) => !p.reads || p.reads(readOpts ?? emptyReadOpts)) ||
      viewHooks.some((p) => !p.reads || p.reads(readOpts ?? emptyReadOpts))
    )

  let view = (query: Query, readOpts?: ReadOpts) => {
    if (readOpts?.native || !viewHooks.length) return null
    let hooks = viewHooks.filter((p) =>
      !p.reads || p.reads(readOpts ?? emptyReadOpts)
    )
    if (!hooks.length) return null
    return continuing(aim(query, address), (q) => {
      let original = typeof q == 'string' ? parse(q) : q
      let ctx = {
        opts: readOpts ?? emptyReadOpts,
        tx: outsideRead(),
        vocab,
      }
      return continuing(
        each(
          hooks,
          null as ReadView | null,
          (at, p) => at ?? p.view!(ctx, original),
        ),
        (out) => out ? { ...out, original } : null,
      )
    })
  }

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
      (rows) => continuing(v.expand ? v.expand(rows) : rows, v.answer),
    )

  let readView = (v: ReadView, readOpts?: ReadOpts) =>
    continuing(candidates(v, readOpts), (bundles) => {
      let p = projection(v.vocab, v.original)
      if (p) {
        return flat(p.fold(matchRows(p.query, v.vocab, readOpts)(bundles)))
      }
      return matcher(v.original, v.vocab, readOpts)(bundles).map(
        only(named(v.vocab, v.original)),
      )
    })

  let getTranslated = (eids: Eid[], comps?: string[], readOpts?: ReadOpts) => {
    if (
      readOpts?.native || !askHooks.length && !answerHooks.length ||
      !rewrites(readOpts)
    ) {
      return storage.get(eids, comps)
    }
    if (!comps?.length) {
      return continuing(
        storage.get(eids, comps),
        (out) => answer(out, readOpts),
      )
    }
    return continuing(ask(and(...comps.map(want)), readOpts), (q) => {
      let names = named(vocab, q, true)
      return continuing(
        storage.get(eids, names ? [...names] : undefined),
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
      view(q, readOpts),
      (v) =>
        v
          ? continuing(
            storage.get(eids),
            (bundles) =>
              continuing(
                continuing(v.expand ? v.expand(bundles) : bundles, v.answer),
                (out) =>
                  out.filter((b) => eids.includes(b.entity.eid)).map(
                    only(comps ? new Set(comps) : null),
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
        view(query, readOpts),
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
          readStored(q, readOpts, q !== query),
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
    ask,
    answer,
    view,
    rewrites,
    read: (q, o) => read(q, o),
    rows: (q, o) => rows(q, o),
    get,
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
