// Whose each entity in the Operator's store is, kept on it as
// `owner{person}` (operator-vocab.ts), so a person's read is screened by one
// component rather than by every path an owner is named on: that screen, made
// per derived read, was past what workerd's SQLite takes (T-155781).
//
// An owner is what the store's components say. A person is named by the
// components that are theirs (`OWNED`), on an entity or on what it hangs on
// (`ON`): a helper's session by the session it works for, an entry by its
// session and that session's parent, a request's files by the request. A
// call, its result and a model's output are also the person's whose
// conversation made them. An entity naming nobody is nobody's; one naming
// one person is theirs; one naming more than one, or a component that names
// nobody, is nobody's to read, and keeps an owner with no person.
//
// The rule (`owning`) writes it in the commit that makes or changes what it
// is read from, so no read sees an entity without its owner or with an old
// one. A store kept before the rule had its owners written by a pass
// (./owner-move.ts), and is read by the paths themselves until the pass says
// it is done (operator-access.ts `owned`).
import type { Bundle, Comp, Plugin, Tx } from '@yaks/graph'
import { dead } from '@yaks/graph/bundle'
import { after, each } from '@yaks/fp'

/** What names its person as an owner, by the property that names them:
 * their conversations and the sessions working for them, their requests, the
 * wake-ups and subscriptions they set, the letters and texts sent for them,
 * the contacts they gave, what they were told, and their drafts. */
export const OWNED: [string, string][] = [
  ['operator_session', 'person'],
  ['operator_request', 'person'],
  ['operator_ask', 'person'],
  ['operator_letter', 'person'],
  ['operator_text', 'person'],
  ['operator_contact', 'person'],
  ['context_output', 'reader'],
  ['deliver', 'to'],
  ['draft', 'by'],
]
/** What an entity hangs on, as a path to what names an owner there. */
export const ON = [
  'spawned.parent.',
  'entry.session.',
  'entry.session.spawned.parent.',
  'operator_files.request.',
]
/** What is also its conversation's: a call, its result, a model's output. */
export const MADE = ['call', 'result', 'output']

/** Where a store says every entity's owner is written: the pass's cursor
 * while it goes on (./owner-move.ts), `done` once it has. A store made new
 * is born done. */
export let OWNERS = 'operator:owners'

let NAMING = OWNED.map(([name]) => name)
// What an entity's owner is read from: what names one on it, what it hangs
// on, and what made it.
let BEARING = [
  ...NAMING,
  'spawned',
  'entry',
  'operator_files',
  ...MADE,
  'created',
]
// What an entity's part in another's owner is read from.
let PART = [...NAMING, 'spawned']

let ref = (b: Bundle | undefined, comp: string, prop: string) => {
  let v = (b?.[comp] as Comp | undefined)?.[prop]
  return v == null ? undefined : String(v)
}

// Whom an entity's own components name: one for each that names an owner,
// null where it names nobody.
let named = (b: Bundle | undefined): (string | null)[] =>
  !b || dead(b) ? [] : OWNED.flatMap(([name, by]) => {
    let c = b[name] as Comp | undefined
    return c ? [c[by] == null ? null : String(c[by])] : []
  })

/** Everyone named as an entity's owner: by it, and by what it hangs on, read
 * through `at`; null where something names nobody. */
export let owners = (
  e: Bundle,
  at: (eid?: string) => Bundle | undefined,
): (string | null)[] => {
  let session = at(ref(e, 'entry', 'session'))
  let via = MADE.some((c) => e[c]) ? at(ref(e, 'created', 'via')) : undefined
  return [
    ...named(e),
    ...named(at(ref(e, 'spawned', 'parent'))),
    ...named(session),
    ...named(at(ref(session, 'spawned', 'parent'))),
    ...named(at(ref(e, 'operator_files', 'request'))),
    ...via?.operator_session
      ? [ref(via, 'operator_session', 'person') ?? null]
      : [],
  ]
}

/** The owner those make: none when nobody is named, the person when only they
 * are, and an owner with no person when more than one is or something names
 * nobody. */
export let owner = (named: (string | null)[]): Comp | null => {
  if (!named.length) return null
  let [first] = named
  return first != null && named.every((p) => p == first)
    ? { person: first }
    : { person: null }
}

type Get = (eids: string[], comps: string[]) => Bundle[] | Promise<Bundle[]>

// What a store answers, now or later: a synchronous store's transaction
// stays synchronous through here (a Durable Object's `transactionSync`).
type Maybe<T> = T | Promise<T>

/** The owner patches these entities owe: each whose kept owner is not the one
 * it makes, read through `get` in three reads: the entities, what they hang
 * on, and what their sessions hang on. */
export let reckon = (get: Get, eids: string[]): Maybe<Bundle[]> => {
  if (!eids.length) return []
  let held = new Map<string, Bundle>()
  let at = (eid?: string) => eid ? held.get(eid) : undefined
  let read = (want: (string | undefined)[], comps: string[]) => {
    let ids = [...new Set(want)].filter((e): e is string => !!e && !held.has(e))
    return after(ids.length ? get(ids, comps) : [], (got) => {
      for (let b of got) held.set(b.entity.eid, b)
    })
  }
  return after(get(eids, [...BEARING, 'owner']), (rows) => {
    let live = rows.filter((r) => !dead(r))
    let up = live.flatMap((e) => [
      ref(e, 'spawned', 'parent'),
      ref(e, 'entry', 'session'),
      ref(e, 'operator_files', 'request'),
      MADE.some((c) => e[c]) ? ref(e, 'created', 'via') : undefined,
    ])
    return after(read(up, PART), () =>
      after(
        read(
          live.map((e) =>
            ref(at(ref(e, 'entry', 'session')), 'spawned', 'parent')
          ),
          NAMING,
        ),
        () =>
          live.flatMap((e) => {
            let want = owner(owners(e, at))
            let had = (e.owner as Comp | undefined) ?? null
            return !had == !want && had?.person == want?.person
              ? []
              : [{ entity: { eid: e.entity.eid }, owner: want }]
          }),
      ))
  })
}

// An entity's own part in another's owner: whom it names, and the session it
// works for, which its sessions' entries hang on too.
let part = (b: Bundle | undefined) =>
  !b || dead(b)
    ? 'gone'
    : JSON.stringify([named(b), ref(b, 'spawned', 'parent') ?? null])

// Fifty at a time, within a statement's bound values.
let fifties = (eids: string[]) =>
  Array.from(
    { length: Math.ceil(eids.length / 50) },
    (_, i) => eids.slice(i * 50, i * 50 + 50).join(','),
  )

let MADE_BY = MADE.map((c) => `.${c}`).join('|')

// The entities that hang on these: a helper's session, an entry, a request's
// files, what a conversation made, and an entry of a helper's session.
let hanging = (tx: Pick<Tx, 'read'>, eids: string[]): Maybe<string[]> => {
  let ids = (qs: string[]) =>
    each(qs, [] as string[], (out, q) =>
      after(
        tx.read(`${q}&.fields=entity.eid`),
        (rows) => [...out, ...rows.map((r) => r.entity.eid)],
      ))
  return after(
    ids(fifties(eids).map((list) => `.spawned.parent=${list}`)),
    (helpers) =>
      after(
        ids(
          fifties(eids).flatMap((list) => [
            `.entry.session=${list}`,
            `.operator_files.request=${list}`,
            `.created.via=${list}&(${MADE_BY})`,
          ]).concat(
            fifties(helpers).map((list) => `.entry.session=${list}`),
          ),
        ),
        (rest) => [...helpers, ...rest],
      ),
  )
}

/**
 * The rule that keeps every entity's owner, in the commit that makes or
 * changes it. Whatever a transaction writes, a caller's batch, a rule's, a
 * cascade's or a stamp's, each entity it wrote an owner is read from on is
 * given the owner it now makes, and so is everything hanging on one whose own
 * part moved: a session carried on by another person, a helper given another
 * parent, a request or conversation deleted. An entity's part is read as the
 * transaction first writes it, and again once its writes are done. The rule's
 * own writes are beneath it, so an owner anyone else writes is put back to
 * the one its entity makes.
 */
export let owning = (): Plugin => ({
  name: 'operator-owner',
  track: (tx) => {
    let before = new Map<string, string>()
    let dirty = new Set<string>()
    let looked = (eids: string[]) => {
      let fresh = [...new Set(eids)].filter((e) => !before.has(e))
      return after(fresh.length ? tx.get(fresh, PART) : [], (rows) => {
        let by = new Map(rows.map((b) => [b.entity.eid, b]))
        for (let e of fresh) before.set(e, part(by.get(e)))
      })
    }
    let touches = (b: Bundle, comps: string[]) =>
      comps.some((c) => b[c] !== undefined)
    let WRITES = [...BEARING, 'owner']
    return {
      tx: {
        ...tx,
        patch: (bundles) => {
          let bearing = bundles.filter((b) => touches(b, WRITES))
          for (let b of bearing) dirty.add(b.entity.eid)
          let naming = bearing.filter((b) => touches(b, PART))
            .map((b) => b.entity.eid)
          return after(looked(naming), () => tx.patch(bundles))
        },
        remove: (entities) => {
          for (let e of entities) dirty.add(e.eid)
          return after(
            looked(entities.map((e) => e.eid)),
            () => tx.remove(entities),
          )
        },
        revive: (eids) => {
          for (let e of eids) dirty.add(e)
          return after(looked(eids), () => tx.revive(eids))
        },
      },
      flush: (bundles) => {
        if (!dirty.size) return bundles
        let wrote = [...dirty], was = new Map(before)
        dirty.clear()
        before.clear()
        return after(was.size ? tx.get([...was.keys()], PART) : [], (rows) => {
          let now = new Map(rows.map((b) => [b.entity.eid, b]))
          let moved = [...was].filter(([e, p]) => part(now.get(e)) != p)
            .map(([e]) => e)
          return after(moved.length ? hanging(tx, moved) : [], (hung) =>
            after(
              reckon((e, c) => tx.get(e, c), [...new Set([...wrote, ...hung])]),
              (patches) =>
                patches.length
                  ? after(tx.patch(patches), () => [
                    ...bundles,
                    ...patches.map((b) => ({ ...b, $quiet: true })),
                  ])
                  : bundles,
            ))
        })
      },
    }
  },
})
