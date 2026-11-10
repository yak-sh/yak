// Who may read each entity, kept on it as `_privacy{person, shut, signed,
// floor, hash}`, so a person's read is screened by one component rather than
// by every declaration a store holds. Asked per derived input, that screen was
// past what workerd's SQLite takes: an app store's `.session` read named it 38
// times, through a reference to what a page inherits from (T-156127).
//
// The privacy is what the declarations say of an entity's components (./
// personal.ts): each `personal` one names its person; each inherited one
// lends what its source's own components say, and one naming no source names
// nobody; each `readers` one asks a floor. An entity wearing none of them
// keeps no privacy; one wearing any keeps one, open or not, with the hash of
// the declarations it was reckoned under.
//
// The rule (`keeping`) writes it in the commit that makes or changes what it
// is read from, and rewrites what hangs on an entity whose own part moved. A
// store holding an entity whose privacy is missing or was reckoned under other
// declarations (`stale`) is read by the declarations themselves, until a pass
// has written them all.
import { after } from '@yaks/fp'
import { absent, type And, and, eq, or } from '@yaks/query/core'
import { dead } from '@yaks/graph/bundle'
import { token } from '@yaks/graph/sha256'
import type { Bundle, Comp, Tracker, Tx } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type Floor, type Level, LEVELS, reaches } from './words.ts'

/** What a store answers, now or later: a synchronous store's transaction
 * stays synchronous through here (a Durable Object's `transactionSync`). */
export type Maybe<T> = T | Promise<T>

/** The component an entity's privacy is kept in. */
export let PRIVACY = '_privacy'

/** The declarations an entity's privacy is reckoned from: who owns each
 * `personal` component, the reference each inherited one reads its source
 * through, and the floor each `readers` one asks. */
export type Declared = {
  owners: [string, string][]
  through: [string, string][]
  floors: [string, Floor][]
}

let ref = (b: Bundle | undefined, comp: string, prop: string) => {
  let v = (b?.[comp] as Comp | undefined)?.[prop]
  return v == null ? undefined : String(v)
}

// Fifty at a time, within a statement's bound values.
let fifties = (eids: string[]) =>
  Array.from(
    { length: Math.ceil(eids.length / 50) },
    (_, i) => eids.slice(i * 50, i * 50 + 50).join(','),
  )

/** What the declarations make of entities, and how a store keeps it. */
export type Privacy = {
  /** The declarations', which each privacy they reckon keeps. */
  hash: string
  /** What an entity's privacy is read from. */
  bearing: string[]
  /** What a source lends the entities inheriting from it. */
  part: string[]
  /** The privacy an entity makes, its sources read through `at`. */
  of: (
    e: Bundle | undefined,
    at: (eid: string) => Bundle | undefined,
  ) => Comp | null
  /** The sources an entity inherits from. */
  sources: (e: Bundle) => string[]
  /** The privacy patches entities owe. */
  reckon: (
    get: (eids: string[], comps: string[]) => Maybe<Bundle[]>,
    eids: string[],
  ) => Maybe<Bundle[]>
  /** The lines stale entities are found by. */
  stale: string[]
  /** Whether a store holds no stale entity. */
  current: (
    read: (line: string) => Maybe<Bundle[]>,
    lines?: string[],
  ) => Maybe<boolean>
  /** The entities a reader may read by their privacy. */
  seen: (who: string | null | undefined, level: Level | null) => And
  /** The rule that keeps every entity's privacy in a transaction. */
  keeping: (tx: Tx, below?: Tx, settling?: () => void) => Tracker
}

/**
 * The privacy these declarations reckon, for a vocabulary that keeps it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { privacy } from '@yaks/member'
 * let p = privacy({
 *   owners: [['draft', 'by']],
 *   through: [['page', 'document']],
 *   floors: [['order', 'editor']],
 * })
 * let docs = { d: { entity: { eid: 'd' }, draft: { by: 'ana' } } }
 * let page = { entity: { eid: 'p' }, page: { document: 'd' }, order: {} }
 * assertEquals(p.of(page, (eid) => docs[eid as 'd']), {
 *   person: 'ana',
 *   shut: null,
 *   signed: null,
 *   floor: 'editor',
 *   hash: p.hash,
 * })
 * assertEquals(p.of({ entity: { eid: 'n' }, note: {} }, () => undefined), null)
 * ```
 */
export let privacy = (declared: Declared): Privacy => {
  // In one order, so that the same declarations hash the same however given.
  let sorted = <T extends [string, string]>(pairs: T[]) =>
    pairs.toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  let owners = sorted(declared.owners), through = sorted(declared.through)
  let floors = sorted(declared.floors)
  let hash = token({ owners, through, floors })!.slice(0, 16)
  /** What an entity's privacy is read from. */
  let bearing = [
    ...new Set([...owners, ...through, ...floors].map(([name]) => name)),
  ]
  /** What a source lends the entities inheriting from it. */
  let part = [...new Set([...owners, ...floors].map(([name]) => name))]

  // Whom a source's components name, and the floors they ask.
  let lend = (b: Bundle, persons: (string | null)[], asked: Set<Floor>) => {
    for (let [name, by] of owners) {
      let c = b[name] as Comp | undefined
      if (c) persons.push(c[by] == null ? null : String(c[by]))
    }
    for (let [name, floor] of floors) if (b[name]) asked.add(floor)
  }

  /** The privacy `e` makes, its sources read through `at`: none for an
   * entity wearing nothing it is read from. */
  let of = (
    e: Bundle | undefined,
    at: (eid: string) => Bundle | undefined,
  ): Comp | null => {
    if (!e || dead(e) || !bearing.some((name) => e[name])) return null
    let persons: (string | null)[] = [], asked = new Set<Floor>()
    lend(e, persons, asked)
    for (let [name, prop] of through) {
      if (!e[name]) continue
      let source = ref(e, name, prop)
      if (!source) persons.push(null)
      else {
        let s = at(source)
        if (s && !dead(s)) lend(s, persons, asked)
      }
    }
    let [first] = persons
    let one = first != null && persons.every((p) => p == first)
    let floor = LEVELS.findLast((l) => asked.has(l)) ?? null
    return {
      person: one ? first : null,
      shut: persons.length && !one ? true : null,
      signed: asked.has('person') ? true : null,
      floor,
      hash,
    }
  }

  let same = (a: Comp | null, b: Comp | null) =>
    !a == !b && (!a ||
      ['person', 'shut', 'signed', 'floor', 'hash'].every((p) =>
        (a[p] ?? null) == (b![p] ?? null)
      ))

  /** The sources an entity inherits from. */
  let sources = (e: Bundle) =>
    through.flatMap(([name, prop]) => ref(e, name, prop) ?? [])

  /** The privacy patches these entities owe, read through `get`: each whose
   * kept privacy is not the one it makes. */
  let reckon = (
    get: (eids: string[], comps: string[]) => Maybe<Bundle[]>,
    eids: string[],
  ): Maybe<Bundle[]> => {
    if (!eids.length) return []
    return after(get(eids, [...bearing, PRIVACY]), (rows) => {
      let wanted = [...new Set(rows.filter((r) => !dead(r)).flatMap(sources))]
      return after(wanted.length ? get(wanted, part) : [], (found) => {
        let held = new Map(found.map((b) => [b.entity.eid, b]))
        return rows.filter((r) => !dead(r)).flatMap((e) => {
          let want = of(e, (eid) => held.get(eid))
          let had = (e[PRIVACY] as Comp | undefined) ?? null
          return same(had, want)
            ? []
            : [{ entity: { eid: e.entity.eid }, [PRIVACY]: want }]
        })
      })
    })
  }

  /** The entities whose privacy is missing or was reckoned under other
   * declarations, as lines a store answers from an index each: what a pass
   * writes, and what a store must hold none of to be read by its privacy. */
  let stale = [
    ...bearing.map((c) => `.${c}&!${PRIVACY}`),
    `.${PRIVACY}.hash<${hash}`,
    `.${PRIVACY}.hash>${hash}`,
  ]

  /** Whether a store, read through `read`, holds no entity whose privacy is
   * stale. */
  let current = (
    read: (line: string) => Maybe<Bundle[]>,
    lines = stale,
  ): Maybe<boolean> =>
    !lines.length ||
    after(
      read(`${lines[0]}&.limit=1&.fields=entity.eid`),
      (rows) => !rows.length && current(read, lines.slice(1)),
    )

  /** The entities `who`, holding `level`, may read by their privacy. */
  let seen = (who: string | null | undefined, level: Level | null) => {
    let at = (prop: string) => `${PRIVACY}.${prop}`
    let reached = LEVELS.filter((l) => reaches(level, l))
    return and(or(
      absent(PRIVACY),
      and(
        who
          ? or(absent(at('person')), eq(at('person'), who))
          : absent(at('person')),
        absent(at('shut')),
        ...who ? [] : [absent(at('signed'))],
        reached.length
          ? or(absent(at('floor')), ...reached.map((l) => eq(at('floor'), l)))
          : absent(at('floor')),
      ),
    ))
  }

  // The entities that hang on these, by every reference they inherit through.
  let hanging = (tx: Pick<Tx, 'read'>, eids: string[]): Maybe<string[]> => {
    let lines = through.flatMap(([name, prop]) =>
      fifties(eids).map((list) => `.${name}.${prop}=${list}&.fields=entity.eid`)
    )
    let out: string[] = []
    let next = (i: number): Maybe<string[]> =>
      i == lines.length ? out : after(tx.read(lines[i]), (rows) => {
        out.push(...rows.map((r) => r.entity.eid))
        return next(i + 1)
      })
    return next(0)
  }

  // An entity's own part in what inherits from it.
  let partOf = (b: Bundle | undefined) =>
    !b || dead(b) ? 'gone' : JSON.stringify(part.map((name) => b[name] ?? null))

  /**
   * The rule that keeps every entity's privacy, in the commit that makes or
   * changes it. Whatever a transaction writes, a caller's batch, a rule's, a
   * cascade's, each entity it wrote privacy is read from on is given the
   * privacy it now makes, and so is everything inheriting from one whose own
   * part moved. The rule's own writes go beneath it, so a privacy anyone else
   * writes is put back. `settling` hears each write that could leave no
   * entity stale: one naming a privacy, as a pass's does, or a removal.
   */
  let keeping = (tx: Tx, below: Tx = tx, settling = () => {}) => {
    let before = new Map<string, string>()
    let dirty = new Set<string>()
    let looked = (eids: string[]) => {
      let fresh = [...new Set(eids)].filter((e) => !before.has(e))
      return after(fresh.length ? tx.get(fresh, part) : [], (rows) => {
        let by = new Map(rows.map((b) => [b.entity.eid, b]))
        for (let e of fresh) before.set(e, partOf(by.get(e)))
      })
    }
    let touches = (b: Bundle, comps: string[]) =>
      comps.some((c) => b[c] !== undefined)
    let writes = [...bearing, PRIVACY]
    return {
      tx: {
        ...below,
        patch: (bundles: Bundle[]) => {
          let bearing = bundles.filter((b) => touches(b, writes))
          for (let b of bearing) dirty.add(b.entity.eid)
          if (bundles.some((b) => b[PRIVACY] !== undefined || b.$delete)) {
            settling()
          }
          let lending = bundles.filter((b) => touches(b, part))
            .map((b) => b.entity.eid)
          return after(looked(lending), () => below.patch(bundles))
        },
        remove: (entities: Bundle['entity'][]) => {
          for (let e of entities) dirty.add(e.eid)
          settling()
          return after(
            looked(entities.map((e) => e.eid)),
            () => below.remove(entities),
          )
        },
        revive: (eids: string[]) => {
          for (let e of eids) dirty.add(e)
          return after(looked(eids), () => below.revive(eids))
        },
      } as Tx,
      flush: (bundles: Bundle[]): Maybe<Bundle[]> => {
        if (!dirty.size) return bundles
        let wrote = [...dirty], was = new Map(before)
        dirty.clear()
        before.clear()
        return after(was.size ? tx.get([...was.keys()], part) : [], (rows) => {
          let now = new Map(rows.map((b) => [b.entity.eid, b]))
          let moved = [...was].filter(([e, p]) => partOf(now.get(e)) != p)
            .map(([e]) => e)
          return after(
            moved.length && through.length ? hanging(tx, moved) : [],
            (hung) =>
              after(
                reckon(
                  (e, c) => tx.get(e, c),
                  [...new Set([...wrote, ...hung])],
                ),
                (patches) =>
                  patches.length
                    ? after(tx.patch(patches), () => [
                      ...bundles,
                      ...patches.map((b) => ({ ...b, $quiet: true })),
                    ])
                    : bundles,
              ),
          )
        })
      },
    }
  }

  return {
    hash,
    bearing,
    part,
    of,
    sources,
    reckon,
    stale,
    current,
    seen,
    keeping,
  }
}

/** Whether a vocabulary keeps privacy: it declares `_privacy`. */
export let kept = (vocab: Vocab): boolean => !!vocab.comp(PRIVACY)
