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
import { EVERY } from './query.ts'
import { type App, type Space, storeName } from './directory.ts'
import type { Env } from './env.ts'
import { vouched, type Who, writes } from './session.ts'
import { storeOf } from './store.ts'
import type { EntityLiteral } from '../../src/mutation.ts'
import { comps, kindOrder } from '../../src/types.ts'
import type { Vocab } from '../../src/store/vocab.ts'
import type { Change } from '../../src/types.ts'

// One store in reach: the app, the space it is in, and who the caller is
// there. `at` is what a bundle names as the component's home.
export type Reach = { space: Space; app: App; who: Who }

export let at = (r: Reach) => `${r.space.slug}/${r.app.slug}`

// One store's /query door, vouched, answered by the listing rule every other
// door answers by (listing.ts). A refusal is thrown as the store's own
// sentence — the fan-out reads it as silence, a caller with one store reads
// it as the error.
//
// `said` is the line the CALLER asked, which the listing rule reads and the
// store need not: a composed read asks each store a part of the line and
// then gathers the bundle by `id=`, and the listing rule applied to those
// words hid the stamps the caller had named — `.book!&.created!` came back
// with no `created` at all, while the same filter naming one app kept it
// (C-32800 item 4). The words a listing is cut by are the caller's, wherever
// the rows were fetched from.
let doorOf = (env: Env, r: Reach, said?: string) => async (line: string) => {
  let asked = line.replace(/^[?&]+/, '')
  let door = storeOf(env.STORE, storeName(r.space, r.app))
  let res = await door(`/query?${asked}`, {}, vouched(r.who))
  let body = await res.text()
  if (!res.ok) throw new Error(body)
  let rows = JSON.parse(body)
  return Array.isArray(rows) ? listed(rows as Row[], said ?? asked) : rows
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
// the ones that ride with every part. A part whose every segment is a REQUEST
// (`.loan?`) narrows nothing — it asks for the component, so it is fetched
// and never intersected.
export let split = (line: string) => {
  let parts = new Map<string, { segs: string[]; asks: boolean }>()
  let global: string[] = []
  for (let seg of segsOf(line)) {
    let key = partOf(seg)
    if (!key) global.push(seg)
    else {
      let one = parts.get(key) ?? { segs: [], asks: true }
      one.segs.push(seg)
      one.asks &&= seg.endsWith('?')
      parts.set(key, one)
    }
  }
  return { parts, global }
}

let eidOf = (r: Row) => String((r.entity as { eid?: string })?.eid ?? '')

// One line, asked of every store at once. A store that refuses contributes
// nothing — the word is another app's, or this one is not the caller's to
// read — but a line EVERY store refuses is a line nobody can answer, and then
// the first store's sentence is what the caller reads.
let asked = async (
  env: Env,
  reach: Reach[],
  line: string,
  said?: string,
) => {
  let tried = await Promise.all(reach.map(async (r) => {
    try {
      return { at: at(r), rows: await doorOf(env, r, said)(line) }
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
// The ranking a text query painted on its hits (graph_query's query-only
// `rank`), kept off the CANDIDATE rows: the composing read addresses eids and
// carries no text pred, so the snippet and the score would be lost between
// the two halves of one search.
let ranksIn = (heard: { at: string; rows: unknown }[]) => {
  let ranks = new Map<string, unknown>()
  for (let h of heard) {
    for (let row of Array.isArray(h.rows) ? h.rows as Row[] : []) {
      if (row.rank && !ranks.has(eidOf(row))) ranks.set(eidOf(row), row.rank)
    }
  }
  return ranks
}

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
//
// Between two app words the filter itself decides, and `must` names the
// components it REQUIRED: `.loan?&.book!` asks for books, so a book is what
// each answer is, and `.book!&.loan?` must not call the same row something
// else. Clause order used to decide it, which made one entity a book or a
// loan by where the caller happened to type the word (C-32800 item 3).
let kindFrom = (
  kinds: string[],
  comps: Record<string, unknown>,
  must: string[] = [],
) => {
  let own = kinds.filter((k) => k && !kindOrder.includes(k))
  return own.find((k) => must.includes(k)) ?? own[0] ??
    kindOrder.find((k) => k in comps) ?? 'entity'
}

// Where one name means two things: the same word declared in two SPACES with
// a column they spell differently (T-32728). Within a space a word has one
// home and the other apps use it, so a disagreement can only be across
// spaces — and there the name is two words. Columns only ONE side declares
// agree by construction: a vocabulary only ever grows.
let apartIn = (vocabs: { r: Reach; vocab: Vocab }[]) => {
  let seen = new Map<string, Map<string, Record<string, string>>>()
  for (let { r, vocab } of vocabs) {
    for (let [name, cols] of Object.entries(vocab)) {
      let by = seen.get(name) ?? new Map()
      seen.set(name, by)
      by.set(r.space.slug, { ...by.get(r.space.slug), ...cols })
    }
  }
  let apart = new Set<string>()
  for (let [name, by] of seen) {
    let sides = [...by.values()]
    for (let i = 0; i < sides.length; i++) {
      for (let j = i + 1; j < sides.length; j++) {
        for (let [col, type] of Object.entries(sides[i])) {
          if (sides[j][col] && sides[j][col] != type) apart.add(name)
        }
      }
    }
  }
  return apart
}

type Held = {
  comps: Record<string, unknown>
  // The kind each store called the row, by the store that said it.
  kinds: Record<string, string>
  home: Record<string, string>
  // A word two SPACES mean two things by (`apartIn`), held per space instead
  // of merged: space → the store that has it and what it holds.
  split: Record<string, Record<string, { at: string; comp: unknown }>>
}

let spaceOf = (at: string) => at.split('/')[0]

// What every store holds about these eids, gathered in one fan-out: the
// components, the kind each store called the row, and WHERE each component
// lives. The read composes bundles out of it; the write routes by it.
//
// `apart` names the words whose shapes DISAGREE across spaces. Those are kept
// per space rather than merged, because one name meaning two things is two
// answers, not one bundle.
let gathered = async (
  env: Env,
  reach: Reach[],
  eids: string[],
  apart: Set<string> = new Set(),
  said?: string,
) => {
  let held = new Map<string, Held>()
  if (!eids.length) return held
  for (
    let { at, rows } of await asked(
      env,
      reach,
      `id=${eids.join(',')}`,
      said,
    )
  ) {
    for (let row of Array.isArray(rows) ? rows as Row[] : []) {
      let eid = eidOf(row)
      if (!eid) continue
      let one = held.get(eid) ?? { comps: {}, kinds: {}, home: {}, split: {} }
      held.set(eid, one)
      for (let [name, comp] of Object.entries(row)) {
        if (name == 'kind') continue
        if (apart.has(name)) {
          one.split[name] ??= {}
          one.split[name][spaceOf(at)] ??= { at, comp }
          continue
        }
        if (name in one.comps) continue
        one.comps[name] = comp
        if (name != 'entity') one.home[name] = at
      }
      one.kinds[at] ??= String(row.kind ?? '')
    }
  }
  return held
}

// One bundle per eid, out of every store that holds a piece of it. One home
// per component, so the first store that answers a component owns it here
// too; `entity` keeps the first store's num, since a num is a store's own
// counter and the eid is what the entity is called everywhere.
//
// `_stores` says which app holds which component, and rides only on a bundle
// that actually spans two — where the composition is the news, and where a
// caller who wants to write one component back needs to know whose it is.
//
// `ask` is the caller's own question, which the gather would otherwise lose:
// the components the answer keeps (`want`), the words two spaces mean two
// things by (`apart`), the line the listing rule cuts by (`said`), and the
// words the filter required (`must`), which is what names the kind.
export type Ask = {
  want?: Set<string> | null
  apart?: Set<string>
  said?: string
  must?: string[]
}

export let composed = async (
  env: Env,
  reach: Reach[],
  eids: string[],
  ask: Ask = {},
) => {
  let { want = null, apart = new Set<string>(), said, must } = ask
  let held = await gathered(env, reach, eids, apart, said)
  let keeps = (name: string) => !want || want.has(name)
  let bundle = (
    one: Held,
    extra: Record<string, unknown>,
    home: Record<string, string>,
    space?: string,
  ) => {
    let comps = Object.fromEntries([
      ...Object.entries(one.comps).filter(([n]) => n == 'entity' || keeps(n)),
      ...Object.entries(extra).filter(([n]) => keeps(n)),
    ])
    let where = Object.fromEntries(
      Object.entries({ ...one.home, ...home }).filter(([n]) => keeps(n)),
    )
    return {
      kind: kindFrom(
        Object.entries(one.kinds)
          .filter(([at]) => !space || spaceOf(at) == space)
          .map(([, k]) => k),
        comps,
        must,
      ),
      // Two spaces mean two things by this word, so the row says which one it
      // is answering for (T-32728).
      ...(space ? { space } : {}),
      ...comps,
      ...(new Set(Object.values(where)).size > 1 ? { _stores: where } : {}),
    }
  }
  return eids.filter((e) => held.has(e)).flatMap((eid) => {
    let one = held.get(eid)!
    // The spaces this entity wears a disputed word in. None, and the bundle
    // is one; two, and it is one per space — the same eid, answered twice,
    // because the name is not one word.
    let spaces = [
      ...new Set(
        Object.entries(one.split).filter(([n]) => keeps(n))
          .flatMap(([, by]) => Object.keys(by)),
      ),
    ]
    if (spaces.length < 2) {
      let mine = Object.entries(one.split).flatMap(([n, by]) =>
        Object.values(by).map((h) => [n, h] as const)
      )
      return [bundle(
        one,
        Object.fromEntries(mine.map(([n, h]) => [n, h.comp])),
        Object.fromEntries(mine.map(([n, h]) => [n, h.at])),
      )]
    }
    return spaces.map((space) => {
      let mine = Object.entries(one.split).flatMap(([n, by]) =>
        by[space] ? [[n, by[space]] as const] : []
      )
      return bundle(
        one,
        Object.fromEntries(mine.map(([n, h]) => [n, h.comp])),
        Object.fromEntries(mine.map(([n, h]) => [n, h.at])),
        space,
      )
    })
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
  // Which stores a word is asked of: the ones whose vocabulary DECLARES it
  // (T-32728 — a word has one home, and a second app declaring it uses that
  // home), and every store for a word nobody declares, which is the
  // platform's and spoken everywhere.
  let { words, apart } = await spoken(env, reach)
  let speak = (name: string) => words.get(name) ?? reach
  let need = [...parts].filter(([, part]) => !part.asks)
  let lines: [Reach[], string][] = need.length
    ? need.map((
      [name, part],
    ) => [speak(name), [...part.segs, ...plain].join('&')])
    : [[reach, plain.join('&')]]
  let ranks = new Map<string, unknown>()
  let sets = await Promise.all(
    lines.map(async ([who, one]) => {
      let heard = await asked(env, who, one)
      for (let [eid, rank] of ranksIn(heard)) ranks.set(eid, rank)
      return ordered(heard)
    }),
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
  if (agg == 'count') return { count: eids.length }
  // The bundle is read from the stores that speak a word the line named, and
  // carries those components — the store's own rule (query.ts `wanted`),
  // applied here because the composing read addresses the eids and names no
  // component. A part this door cannot confirm IS a component (an unqualified
  // prop, a reference path) asks for the whole bundle rather than guess.
  let named = [...parts.keys()]
  let want = named.length && !segsOf(line).includes(EVERY) &&
      named.every((n) => words.has(n) || n in comps)
    ? new Set(named)
    : null
  let from = named.length ? [...new Set(named.flatMap(speak))] : reach
  let bundles = await composed(env, from, eids, {
    want,
    apart,
    said: line,
    must: need.map(([name]) => name),
  }) as Row[]
  return bundles.map((b) => {
    let rank = ranks.get(eidOf(b))
    return rank ? { ...b, rank } : b
  })
}

// A write is routed the same way a read is composed (T-32700): a bundle is
// split by component and each part goes to the app that word belongs to. One
// home per component — a word an app DECLARED is that app's row wherever the
// call was aimed, and a word the platform shares (doc, comment, dependency)
// goes where the call, the entity's own history, or the rest of its bundle
// says.

// The words one store declares as its own (its vocab.json, T-32502, as the
// store last accepted it). A component nobody declares is the platform's, and
// every store speaks it.
let vocabAt = async (env: Env, r: Reach): Promise<Vocab> => {
  let res = await storeOf(env.STORE, storeName(r.space, r.app))('/vocab')
  if (!res.ok) {
    await res.body?.cancel()
    return {}
  }
  return await res.json() as Vocab
}

// Which stores declare which word — the routing table a write follows and the
// reach set a read narrows by, in app order (oldest first), so the first
// declarer is the word's home. `apart` is the other half of the same read:
// the words two SPACES mean two things by, which a bundle must not merge.
let spoken = async (env: Env, reach: Reach[]) => {
  let own = await Promise.all(
    reach.map(async (r) => ({ r, vocab: await vocabAt(env, r) })),
  )
  let words = new Map<string, Reach[]>()
  for (let { r, vocab } of own) {
    for (let w of Object.keys(vocab)) {
      words.set(w, [...(words.get(w) ?? []), r])
    }
  }
  return { words, apart: apartIn(own) }
}

// The keys of a bundle that name no component: its address, its
// preconditions, and its death.
let NOT_A_COMP = ['entity', 'was', 'tombstone']

// A bundle addressed by anything but an eid — a spine num, the older key/id
// literal — cannot be split, because the halves would have to find each other
// by an address only one store can resolve.
let elsewhere = (e: EntityLiteral) =>
  e.entity?.num != null || e.key != null || e.id != null

// Every `$alias` in the batch, minted HERE. A bundle that lands in two stores
// must land under ONE eid, and two stores minting their own would make two
// entities out of one — so the door mints, the answer maps the alias to what
// it minted, and each store is handed an eid it has only to accept. A bundle
// with no address at all is minted the same way, for the same reason.
let minted = (batch: EntityLiteral[]) => {
  let aliases: Record<string, string> = {}
  let eids = batch.map((e) => {
    let eid = e.entity?.eid
    if (typeof eid == 'string') {
      return eid.startsWith('$') ? (aliases[eid] ??= crypto.randomUUID()) : eid
    }
    return elsewhere(e) ? null : crypto.randomUUID()
  })
  // An alias stands wherever an eid goes — a ref column, a dependency child,
  // a nested bundle's address — so the swap is the whole batch's, by value.
  let swap = (v: unknown): unknown =>
    typeof v == 'string'
      ? aliases[v] ?? v
      : Array.isArray(v)
      ? v.map(swap)
      : v && typeof v == 'object'
      ? Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map((
          [k, x],
        ) => [k, swap(x)]),
      )
      : v
  let entities = batch.map((e, i) => {
    let one = swap(e) as EntityLiteral
    return eids[i] ? { ...one, entity: { ...one.entity, eid: eids[i]! } } : one
  })
  return { entities, eids, aliases }
}

type Part = { r: Reach; entities: EntityLiteral[] }

// One store's /apply door, vouched. `check` asks only whether the batch would
// be admitted (store.ts) — nothing is written and nothing is cast. The access
// rule is the page's: an owner or editor writes, and so does anyone at all
// when the app is open.
let sent = async (
  env: Env,
  part: Part,
  check: boolean,
  headers: Record<string, string> = {},
) => {
  let r = part.r
  if (!writes(r.who, r.app.access)) {
    throw new Error(`not a writer of ${at(r)}`)
  }
  let door = storeOf(env.STORE, storeName(r.space, r.app))
  let res = await door(`/apply${check ? '?check=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify({ entities: part.entities }),
  }, { ...vouched(r.who), ...headers })
  let body = await res.text()
  if (!res.ok) throw new Error(`${at(r)}: ${body}`)
  return JSON.parse(body) as {
    changes?: Change[]
    aliases?: Record<string, string>
  }
}

// The batch, split by component into one part per store.
let routed = async (
  env: Env,
  reach: Reach[],
  named: Reach | undefined,
  batch: EntityLiteral[],
) => {
  let { entities, eids, aliases } = minted(batch)
  let { words, apart } = await spoken(env, reach)
  // Where the entity already lives, read only when the answer depends on it:
  // a death fans out to whoever holds the eid, and a shared word with no app
  // named goes to the app that already wears it.
  let asking = entities.flatMap((e, i) =>
    eids[i] && (e.tombstone != null ||
        (!named &&
          Object.keys(e).some((k) => !NOT_A_COMP.includes(k) && !words.has(k))))
      ? [eids[i]!]
      : []
  )
  let held = await gathered(env, reach, asking)
  let by = (label: string) => reach.find((r) => at(r) == label)
  // The one store a bundle that cannot be split goes to.
  let only = () => {
    if (named) return named
    if (reach.length == 1) return reach[0]
    throw new Error(
      `name the app this goes in — ${reach.map((r) => r.app.slug).join(', ')}`,
    )
  }
  let home = (name: string, eid: string | null, mates: Reach[]): Reach => {
    let declared = words.get(name) ?? []
    let mine = eid ? held.get(eid)?.home ?? {} : {}
    if (declared.length) {
      // A word has ONE home: the first app to declare it (T-32728). A second
      // app declaring the same word is a USE of it, and its writes land in
      // the home store — which is what lets a lending app write a `book` the
      // reading list owns. Where the entity already wears the word wins over
      // birth order, and a named app wins over both when it is one of the
      // declarers, since across spaces two apps may mean two things by one
      // name (T-32728 again, still open).
      let where = mine[name] && by(mine[name])
      if (where && declared.includes(where)) return where
      if (named && declared.includes(named)) return named
      // Across spaces the shapes may disagree, and then the name is two
      // words: nothing here can pick between them, so the caller does.
      let spaces = [...new Set(declared.map((r) => r.space.slug))]
      if (apart.has(name) && spaces.length > 1) {
        throw new Error(
          `${name} means two things — ${spaces.join(' and ')} declare it ` +
            'differently; name the app this goes in',
        )
      }
      return declared[0]
    }
    if (named) return named
    let where = mine[name] && by(mine[name])
    if (where) return where
    let holders = [...new Set(Object.values(mine))].map(by).filter(Boolean)
    if (holders.length == 1) return holders[0]!
    // A title beside a recipe is the recipe's title: a shared word with
    // nowhere else to go rides with the app whose own words are in the same
    // bundle, which is what makes writing a NEW entity one call.
    if (mates.length == 1) return mates[0]
    if (reach.length == 1) return reach[0]
    throw new Error(
      `which app should ${name} go in? name one with app — ${
        reach.map((r) => r.app.slug).join(', ')
      }`,
    )
  }
  let parts = new Map<Reach, EntityLiteral[]>()
  let add = (r: Reach, e: EntityLiteral) =>
    parts.set(r, [...(parts.get(r) ?? []), e])
  for (let [i, e] of entities.entries()) {
    let eid = eids[i]
    if (!eid) {
      add(only(), e)
      continue
    }
    // Death is the whole entity's, so it goes wherever the entity is: every
    // store holding a piece of it, and the app named when none does yet.
    if (e.tombstone) {
      let holders = [...new Set(Object.values(held.get(eid)?.home ?? {}))]
        .map(by).filter(Boolean) as Reach[]
      for (let r of holders.length ? holders : [only()]) {
        add(r, { entity: { eid }, tombstone: {} })
      }
      continue
    }
    // A `was` guard rides with the component it guards, whether or not this
    // batch also writes that component — a precondition that lost its part
    // would silently stop guarding.
    let names = [
      ...new Set([
        ...Object.keys(e).filter((k) => !NOT_A_COMP.includes(k)),
        ...Object.keys(e.was ?? {}),
      ]),
    ]
    let mine = new Map<Reach, string[]>()
    let take = (r: Reach, name: string) =>
      mine.set(r, [...(mine.get(r) ?? []), name])
    // The app's own words first: they are what a shared word rides with.
    for (let name of names.filter((n) => words.has(n))) {
      take(home(name, eid, []), name)
    }
    let mates = [...mine.keys()]
    for (let name of names.filter((n) => !words.has(n))) {
      take(home(name, eid, mates), name)
    }
    for (let [r, keys] of mine) {
      let was = Object.fromEntries(
        Object.entries(e.was ?? {}).filter(([n]) => keys.includes(n)),
      )
      add(r, {
        entity: { ...e.entity, eid },
        ...Object.fromEntries(
          keys.filter((n) => n in e).map((n) => [n, e[n]]),
        ),
        ...(Object.keys(was).length ? { was } : {}),
      })
    }
  }
  return {
    parts: [...parts].map(([r, entities]) => ({ r, entities })),
    aliases,
  }
}

// The write, whole: routed, admitted everywhere, then committed. A refusal in
// any store is the caller's error and leaves every other store unwritten,
// because admission ran first (store.ts `check`) — a single part needs no
// second round trip, since its commit IS its admission.
export let written = async (
  env: Env,
  reach: Reach[],
  named: Reach | undefined,
  batch: EntityLiteral[],
  headers: Record<string, string> = {},
) => {
  let { parts, aliases } = await routed(env, reach, named, batch)
  if (!parts.length) throw new Error('entities: nothing to write')
  if (parts.length > 1) {
    await Promise.all(parts.map((p) => sent(env, p, true, headers)))
  }
  let outs = await Promise.all(parts.map((p) => sent(env, p, false, headers)))
  return {
    body: JSON.stringify({
      changes: outs.flatMap((o) => o.changes ?? []),
      aliases: outs.reduce((all, o) => ({ ...all, ...o.aliases }), aliases),
    }),
    where: parts.map((p) => at(p.r)).join(' and '),
  }
}
