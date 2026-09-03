// An entity SPANS apps (T-32698): the eid a client minted is the same thing
// in every store, so the recipe an app saved and the loan another app wrote
// about it are one entity wearing two components, one per app. A read that
// names no app is therefore one question asked of every store the caller can
// reach, answered as ONE bundle per eid. This module is that composition —
// the fan-out, the split a mixed filter needs, and the merge — and tools.ts
// owns which stores are in reach.
//
// The split is HERE and not in src/query.ts: a store refuses a word it never
// planted ("unknown prop: .book"), so `.recipe!&.book!` cannot be asked of
// either store whole. The line is cut on its own `&` seams — one part per
// component named — each part asked of every store, and the eids in common
// are the answer. The grammar itself is untouched: every part is an ordinary
// filter line, and a store that cannot speak one is simply silent about it.
import { listed, type Row } from './listing.ts'
import { type App, type Space, storeName } from './directory.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { storeOf } from './store.ts'
import { kindOrder } from '../../src/types.ts'

// One store in reach: the app, the space it is in, and who the caller is
// there. `at` is what a bundle names as the component's home.
export type Reach = { space: Space; app: App; who: Who }

export let at = (r: Reach) => `${r.space.slug}/${r.app.slug}`

// One store's /query door, vouched, answered by the listing rule every other
// door answers by (listing.ts). A refusal is thrown as the store's own
// sentence — the fan-out reads it as silence, a caller with one store reads
// it as the error.
let doorOf = (env: Env, r: Reach) => async (line: string) => {
  let asked = line.replace(/^[?&]+/, '')
  let door = storeOf(env.STORE, storeName(r.space, r.app))
  let res = await door(`/query?${asked}`, {}, vouched(r.who))
  let body = await res.text()
  if (!res.ok) throw new Error(body)
  let rows = JSON.parse(body)
  return Array.isArray(rows) ? listed(rows as Row[], asked) : rows
}

// The words a dotted segment can open with that name no component: the
// grammar's own riders and its aggregates. Everything else after a dot is a
// component or a prop that routes to one, and either way it is the segment's
// part.
let RIDERS = ['order', 'near', 'limit', 'after', 'edges', 'reaches', 'kind']
let AGGS = ['count', 'distinct', 'tally']

let firstWord = (seg: string) => /^\.([a-z0-9_]+)/i.exec(seg)?.[1] ?? ''

// The part a segment belongs to: the component it names, or '' for a segment
// that is the whole line's business — `id=`, `limit=`, a bare word, a rider.
// An unqualified prop (`.serves=4`) names no component textually and gets a
// part of its own, since the store that knows the prop is the store that
// knows the component behind it.
let partOf = (seg: string) => {
  if (!seg.startsWith('.')) return ''
  let word = firstWord(seg)
  return RIDERS.includes(word) || AGGS.includes(word) ? '' : word
}

let segsOf = (line: string) =>
  line.replace(/^[?&]+/, '').split('&').filter(Boolean)

let aggOf = (line: string) =>
  segsOf(line).map(firstWord).find((w) => AGGS.includes(w))

let limitOf = (line: string) =>
  Number(segsOf(line).find((s) => /^\.?limit=/.test(s))?.split('=')[1]) ||
  undefined

// A filter line cut into parts: the segments that name each component, and
// the ones that ride with every part.
export let split = (line: string) => {
  let parts = new Map<string, string[]>()
  let global: string[] = []
  for (let seg of segsOf(line)) {
    let key = partOf(seg)
    if (!key) global.push(seg)
    else parts.set(key, [...(parts.get(key) ?? []), seg])
  }
  return { parts, global }
}

let eidOf = (r: Row) => String((r.entity as { eid?: string })?.eid ?? '')

// One line, asked of every store at once. A store that refuses contributes
// nothing — the word is another app's, or this one is not the caller's to
// read — but a line EVERY store refuses is a line nobody can answer, and then
// the first store's sentence is what the caller reads.
let asked = async (env: Env, reach: Reach[], line: string) => {
  let tried = await Promise.all(reach.map(async (r) => {
    try {
      return { at: at(r), rows: await doorOf(env, r)(line) }
    } catch (e) {
      return { at: at(r), why: e instanceof Error ? e.message : String(e) }
    }
  }))
  let heard = tried.filter((t) => 'rows' in t) as {
    at: string
    rows: unknown
  }[]
  if (!heard.length && tried.length) {
    throw new Error((tried[0] as { why: string }).why)
  }
  return heard
}

// The eids one fan-out selects, in the order the answer keeps. Ranked hits
// (a text query wears a query-only `rank`) INTERLEAVE — a score is one
// store's own measure and means nothing beside another's, so the merge takes
// each store's best, then each store's second, which is the only ordering
// both stores agree with. Everything else is store by store, each in its own
// creation order.
let ordered = (heard: { at: string; rows: unknown }[]) => {
  let lists = heard.map((h) => (Array.isArray(h.rows) ? h.rows as Row[] : []))
  let ranked = lists.some((rows) => rows.some((r) => 'rank' in r))
  let out: string[] = []
  if (ranked) {
    for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
      for (let rows of lists) if (rows[i]) out.push(eidOf(rows[i]))
    }
  } else for (let rows of lists) for (let r of rows) out.push(eidOf(r))
  return [...new Set(out.filter(Boolean))]
}

// A store's own word is the most specific thing said about a row, wherever it
// was said (types.ts kindOf, C-32574 item 7) — so an app's kind outranks a
// platform kind from another store, and the union decides the rest.
let kindFrom = (kinds: string[], comps: Record<string, unknown>) =>
  kinds.find((k) => k && !kindOrder.includes(k)) ??
    kindOrder.find((k) => k in comps) ?? 'entity'

// One bundle per eid, out of every store that holds a piece of it. One home
// per component, so the first store that answers a component owns it here
// too; `entity` keeps the first store's num, since a num is a store's own
// counter and the eid is what the entity is called everywhere.
//
// `_stores` says which app holds which component, and rides only on a bundle
// that actually spans two — where the composition is the news, and where a
// caller who wants to write one component back needs to know whose it is.
export let composed = async (env: Env, reach: Reach[], eids: string[]) => {
  if (!eids.length) return []
  let held = new Map<string, {
    comps: Record<string, unknown>
    kinds: string[]
    home: Record<string, string>
  }>()
  for (let { at, rows } of await asked(env, reach, `id=${eids.join(',')}`)) {
    for (let row of Array.isArray(rows) ? rows as Row[] : []) {
      let eid = eidOf(row)
      if (!eid) continue
      let one = held.get(eid) ?? { comps: {}, kinds: [], home: {} }
      held.set(eid, one)
      for (let [name, comp] of Object.entries(row)) {
        if (name == 'kind') continue
        if (name in one.comps) continue
        one.comps[name] = comp
        if (name != 'entity') one.home[name] = at
      }
      one.kinds.push(String(row.kind ?? ''))
    }
  }
  return eids.filter((e) => held.has(e)).map((eid) => {
    let one = held.get(eid)!
    let homes = new Set(Object.values(one.home))
    return {
      kind: kindFrom(one.kinds, one.comps),
      ...one.comps,
      ...(homes.size > 1 ? { _stores: one.home } : {}),
    }
  })
}

// The read, whole. One store in reach and this is that store's own answer,
// untouched — the same door, the same words, the same refusal. Several, and
// the line is split, each part asked of all of them, the eids in common taken
// (a filter's `&` IS an intersection), and the bundles composed.
//
// A window is the one place the split shows: `limit=` bounds each PART before
// the parts meet, so a mixed filter's window is the newest of each side, then
// the newest of what they had in common.
export let read = async (
  env: Env,
  reach: Reach[],
  line: string,
): Promise<unknown> => {
  if (reach.length == 1) return await doorOf(env, reach[0])(line)
  let agg = aggOf(line)
  if (agg && agg != 'count') {
    throw new Error(
      `a ${agg} reads one app at a time — name one with app, or ask for the ` +
        'rows and reduce them',
    )
  }
  let { parts, global } = split(line)
  let plain = global.filter((s) => !AGGS.includes(firstWord(s)))
  let lines = parts.size
    ? [...parts.values()].map((segs) => [...segs, ...plain].join('&'))
    : [plain.join('&')]
  let sets = await Promise.all(
    lines.map(async (one) => ordered(await asked(env, reach, one))),
  )
  let [first, ...rest] = sets
  let eids = rest.reduce(
    (kept, set) => kept.filter((e) => set.includes(e)),
    first ?? [],
  )
  let limit = limitOf(line)
  if (limit != null && eids.length > limit) eids = eids.slice(0, limit)
  // `.count!` over a fan-out is how many ENTITIES the filter selects, which
  // is the size of the composed set — summing each store's own count would
  // count an entity that lives in two of them twice.
  return agg == 'count'
    ? { count: eids.length }
    : await composed(env, reach, eids)
}
