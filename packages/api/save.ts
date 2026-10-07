// Saving is independent of relay cadence: hold the latest admitted value,
// store it when its stored entity matches the query, even after disconnect.
import { matcher } from '@yaks/match'
import { after, isPromise, over } from '@yaks/fp'
import {
  type Actor,
  type Bundle,
  type Comp,
  comps,
  formed,
  type Graph,
  signed,
} from '@yaks/graph'
import { saveOf, syncOf } from '@yaks/vocab'
import { and, bare, type Clause, eq, parse, timeEdges } from '@yaks/query'
import type { Timer } from './relay.ts'
import { type Interest, interest } from './interest.ts'

/** The receiving door's identity and vocabulary versions, never client claims. */
export type PeerWriter = {
  actor?: Actor | null
  speaks?: Record<string, number>
}

type Value<C> = {
  conn: C
  writer: PeerWriter
  row: Bundle
  connected: boolean
  dirty: boolean
  waiting?: boolean
  reading?: boolean
  invalidated?: boolean
  cancel?: () => void
}

/** Latest peer values saved through the graph's ordinary write boundary. */
export let saving = <C>(
  graph: Graph,
  timer: Timer,
  failed: (conn: C, err: unknown) => void,
  now: () => number = () => Date.now(),
) => {
  let values = new Map<string, Value<C>>()
  let signedRows = (rows: Bundle[], writer: PeerWriter) =>
    signed(
      rows.map((b) => ({
        ...b,
        ...writer.speaks ? { $speaks: writer.speaks } : {},
      })),
      writer.actor ?? null,
    )
  let forget = (key: string, v: Value<C>) => {
    v.cancel?.()
    v.cancel = undefined
    if (values.get(key) === v) values.delete(key)
  }
  // A clock can move a relative-time comparison only when its property
  // exists and the other eligibility predicates already hold. Preserve those
  // predicates (notably .player) instead of polling every nonmatching entity.
  let clockQuery = (query: Clause): Clause | null => {
    let timed = false
    let relax = (c: Clause): Clause => {
      if (c.kind == 'and' || c.kind == 'or') {
        let clauses = c.clauses.map(relax)
        return clauses.some((part, i) => part !== c.clauses[i])
          ? { ...c, clauses }
          : c
      }
      if (c.kind != 'pred') return c
      if (c.where) {
        // Under a negative quantifier, making the child easier makes the
        // parent harder. A clock-sensitive negative association is possible,
        // not its negated presence approximation.
        let where = relax(c.where)
        let changed = where !== c.where
        if (c.not && changed) return { kind: 'and', clauses: [] }
        return changed ? { ...c, where } : c
      }
      if (!c.value || c.op == '~=') return c
      let assoc = graph.vocab.assoc(c.path[0])
      if (assoc && c.path.length == 1) return c
      let [leaf] = graph.vocab.aim(
        (assoc ? c.path.slice(1) : c.path).join('.'),
        bare(c),
      ).slice(-1)
      let prop = leaf && graph.vocab.prop(leaf.comp, leaf.prop)
      if (prop?.scalar != 'time' && prop?.scalar != 'number') return c
      let text = (v: NonNullable<typeof c.value>): string =>
        v.kind == 'list'
          ? v.items.map(text).join(',')
          : v.kind == 'range'
          ? text(v.lo) + (v.exclusiveEnd ? '...' : '..') + text(v.hi)
          : v.raw
      let op = c.op == '!=' ? '=' : c.op
      let edges = timeEdges(op, text(c.value), now())
      if (
        !edges ||
        JSON.stringify(edges) ==
          JSON.stringify(timeEdges(op, text(c.value), now() + 366 * 86_400_000))
      ) return c
      timed = true
      // A negative comparison can hold for a missing value as well.
      return c.not || c.op == '!='
        ? { kind: 'and', clauses: [] }
        : { ...c, op: '!', value: null }
    }
    let out = relax(query)
    return timed ? out : null
  }
  // A simple local relative-time predicate has a known crossing. Hold its
  // deadline, not a one-second SQL poll. Associations, negations and computed
  // predicates keep the general retry path; relevant commits still invalidate
  // either timer through the same eligibility interest.
  let deadline = (query: Clause, row: Bundle): number | null => {
    let waits: number[] = [], uncertain = false
    let visit = (c: Clause) => {
      if (c.kind == 'and' || c.kind == 'or') {
        c.clauses.forEach(visit)
        return
      }
      if (c.kind != 'pred' || !c.value || c.op == '~=') return
      if (c.value.kind != 'scalar' && c.value.kind != 'time') {
        uncertain = true
        return
      }
      let edges = timeEdges(c.op, c.value.raw, now())
      if (!edges) return
      let future = timeEdges(c.op, c.value.raw, now() + 1000)
      if (JSON.stringify(edges) == JSON.stringify(future)) return
      if (c.where || graph.vocab.assoc(c.path[0])) {
        uncertain = true
        return
      }
      let hops = graph.vocab.aim(c.path.join('.'), bare(c))
      let hop = hops[0]
      if (
        c.not || c.where || hops.length != 1 || !hop ||
        graph.vocab.assoc(c.path[0]) ||
        graph.vocab.prop(hop.comp, hop.prop)?.computed ||
        edges.length != 1 || edges[0].length != 1 ||
        !['<', '<='].includes(edges[0][0][0]) ||
        future?.[0]?.[0]?.[1] != edges[0][0][1] + 1000
      ) {
        uncertain = true
        return
      }
      let value = (row[hop.comp] as Comp | undefined)?.[hop.prop]
      let at = graph.vocab.prop(hop.comp, hop.prop)?.scalar == 'time'
        ? Date.parse(String(value))
        : Number(value)
      if (!Number.isFinite(at)) {
        uncertain = true
        return
      }
      let wait = at - edges[0][0][1] + (edges[0][0][0] == '<' ? 1 : 0)
      if (wait > 0) waits.push(wait)
    }
    visit(query)
    return uncertain || !waits.length ? null : Math.min(...waits)
  }
  let later = (key: string, v: Value<C>, ms: number) => {
    v.cancel?.()
    v.cancel = timer(() => {
      v.cancel = undefined
      try {
        let out = save(key, v)
        if (isPromise(out)) return out.catch((err) => failed(v.conn, err))
      } catch (err) {
        failed(v.conn, err)
      }
    }, ms)
  }
  let save = (key: string, v: Value<C>) => {
    v.cancel?.()
    v.cancel = undefined
    v.waiting = false
    if (!v.dirty) return
    v.reading = true
    v.invalidated = false
    let [comp] = comps(v.row)[0]
    let condition = parse(saveOf(graph.vocab, comp)!)
    let scope = eq('entity.eid', v.row.entity.eid)
    let failedRead = (err: unknown): never => {
      v.reading = false
      v.waiting = true
      throw err
    }
    let rows: Bundle[] | Promise<Bundle[]>
    let local = (c: Clause): boolean => {
      if (c.kind == 'and' || c.kind == 'or') return c.clauses.every(local)
      if (
        c.kind != 'pred' || c.where || graph.vocab.assoc(c.path[0]) ||
        c.path.length > 2
      ) return false
      let name = c.path[0]
      return !!graph.vocab.comp(name) && !graph.vocab.comp(name)?.computed &&
        (c.path.length == 1 ||
          !graph.vocab.prop(name, c.path[1])?.computed &&
            graph.vocab.prop(name, c.path[1])?.category != 'ref')
    }
    let possibleLocal: Bundle[] | undefined
    try {
      if (local(condition)) {
        let names = [
          ...new Set((function names(c: Clause): string[] {
            return c.kind == 'and' || c.kind == 'or'
              ? c.clauses.flatMap(names)
              : c.kind == 'pred'
              ? [c.path[0]]
              : []
          })(condition)),
        ]
        rows = after(
          graph.get([v.row.entity.eid], names, { native: true, durable: true }),
          (stored) => {
            possibleLocal = stored
            return matcher(and(scope, condition), graph.vocab, { now: now() })(
              stored,
            )
          },
        )
      } else {
        rows = graph.read({
          kind: 'and',
          clauses: [
            ...and(scope, condition).clauses,
            ...parse('.fields=entity.eid').clauses,
          ],
        }, { now: now(), native: true })
      }
    } catch (err) {
      return failedRead(err)
    }
    return after(
      isPromise(rows) ? rows.catch(failedRead) : rows,
      (rows) => {
        v.reading = false
        if (!rows.length) {
          v.waiting = true
          if (v.invalidated) {
            later(key, v, 0)
            return
          }
          let clock = clockQuery(condition)
          if (!clock) return
          return after(
            possibleLocal
              ? matcher(and(scope, clock), graph.vocab, { now: now() })(
                possibleLocal,
              )
              : graph.read(and(scope, clock), { now: now(), native: true }),
            (possible) => {
              if (possible.length) {
                later(key, v, deadline(condition, possible[0]) ?? 1000)
              }
            },
          )
        }
        let row = v.row
        return after(graph.apply(signedRows([row], v.writer)), () => {
          if (v.row === row) v.dirty = false
          if (!v.connected || comps(row)[0][1] == null) forget(key, v)
        })
      },
    )
  }
  // A non-clock eligibility change is owed by a commit, not by an endless
  // timer. Recheck after the write releases; graph.apply may be asynchronous
  // and this hook must never wait for registry work that contains that write.
  let interests = new Map<string, Interest | null>()
  let changed = (v: Value<C>, bundles: Bundle[]) => {
    let [comp] = comps(v.row)[0]
    if (!interests.has(comp)) {
      interests.set(
        comp,
        interest(
          parse(saveOf(graph.vocab, comp)!),
          graph.vocab,
          () => true,
        ),
      )
    }
    let i = interests.get(comp)
    return !i || i.unseen ||
      bundles.some((b) =>
        comps(b).some(([name]) =>
          i.far.has(name) || i.via.has(name) ||
          (b.entity.eid == v.row.entity.eid && i.near.has(name))
        )
      )
  }
  graph.use({
    name: '@yaks/api/save',
    hooks: {
      effect: (bundles) => {
        for (let [key, v] of values) {
          if (!v.dirty || !changed(v, bundles)) continue
          if (v.reading) v.invalidated = true
          else if (v.waiting) later(key, v, 0)
        }
        return bundles
      },
    },
  })
  let write = (
    conn: C,
    bundles: Bundle[],
    writer: PeerWriter = {},
    held: Bundle[] = [],
  ) => {
    bundles = formed(bundles)
    // Pending saves survive disconnect; current relay values also supply the
    // complete proposed component for checking a partial patch.
    let overlay = bundles.flatMap((b) =>
      comps(b).flatMap(([comp]) => {
        let v = values.get(b.entity.eid + ' ' + comp)
        return v ? [v.row] : []
      })
    ).concat(held)
    return after(
      graph.admit(signedRows(bundles, writer), { overlay }),
      (admitted) => {
        let accepted = admitted.flatMap((b) => {
          let row: Bundle = { entity: { eid: b.entity.eid } }
          for (let [comp, patch] of comps(b)) {
            if (syncOf(graph.vocab, comp) == 'peers') row[comp] = patch
          }
          return comps(row).length ? [row] : []
        })
        let rows = accepted.flatMap((b) =>
          comps(b).flatMap(([comp, patch]) =>
            saveOf(graph.vocab, comp) == null ? [] : [{
              entity: b.entity,
              [comp]: patch == null ? null : {
                ...values.get(b.entity.eid + ' ' + comp)?.row[comp] as Comp,
                ...patch,
              },
            }]
          )
        )
        return after(
          over(rows, (row) => {
            let [comp] = comps(row)[0]
            let key = row.entity.eid + ' ' + comp
            let was = values.get(key)
            let v: Value<C> = was ??
              { conn, writer, row, connected: true, dirty: false }
            v.connected = true
            v.conn = conn
            v.writer = writer
            v.row = row
            v.dirty = true
            values.set(key, v)
            // Eligibility reads stored state, never this incoming peer value.
            // A pending clock/commit retry already owns the next read; new
            // patches only replace the value it will save. Re-reading here
            // both duplicates the retry and cancels/restarts its clock.
            if (v.waiting || v.reading || v.cancel) return
            return save(key, v)
          }),
          () => accepted,
        )
      },
    )
  }
  let drop = (conn: C) =>
    after(
      over([...values], ([key, v]) => {
        if (v.conn !== conn) return
        v.connected = false
        if (!v.dirty) return forget(key, v)
        let refused = (err: unknown) => {
          forget(key, v)
          failed(conn, err)
        }
        try {
          let out = save(key, v)
          return isPromise(out) ? out.catch(refused) : out
        } catch (err) {
          refused(err)
        }
      }),
      () => {},
    )
  return { write, drop }
}
