// A graph made of graphs. An entity is one eid wherever it is kept, so the
// recipe one member holds and the loan another holds about it are one entity
// wearing two components. A read that names no member is therefore one
// question asked of every member, answered as one bundle per eid; a write is
// split by component and each part sent to the member that word lives in.
//
// A member is a value: it reads a line, applies bundles, and says its own
// words. Where it is (a Durable Object, a remote host, a graph in memory) is
// the caller's business; everything here is the fan-out, the split a mixed
// filter needs, the merge, and the routing of a write.
//
// The split is here and not in a member: a member refuses a word it never
// planted ("unknown prop: .book"), so `.recipe&.book` cannot be asked of
// either whole. The line is cut on its own `&` seams, one part per component
// named, each part asked of every member that speaks it, and the eids in
// common are the answer. The grammar is untouched: every part is an ordinary
// filter line, and a member that cannot speak one is silent about it.
//
// Two things this does that no single member can. An order over a spanning
// answer is settled over the merged bundles, with @yaks/match: each member can
// only order what it holds. And the vocabulary is the union of what the
// members declare, the language a merged bundle is written in.
import { archetypes } from '@yaks/archetype'
import { edges } from '@yaks/edge'
import type { Bundle, Entity, Projection } from '@yaks/graph'
import { dead } from '@yaks/graph/bundle'
import { status } from '@yaks/graph/errors'
import { derivedEid, identities, resolve } from '@yaks/graph/identity'
import { flat, projection } from '@yaks/graph/read'
import { keys } from '@yaks/key'
import { matcher, rows } from '@yaks/match'
import { bareLine, parse, tokens } from '@yaks/query'
import { CallError } from '@yaks/tools/errors'
import {
  loadVocab,
  type PropSchema,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'

/** One graph in the composition. */
export type Member = {
  /** What a merged bundle names as a component's home (`_stores`). */
  at: string
  /** What a caller calls it when asked to choose one. Defaults to `at`. */
  name?: string
  /** The members whose words agree on their shapes: a word two spaces
   * declare with different properties is two words (`apartIn`). Defaults to
   * `at`. */
  space?: string
  /** The bundles a filter line selects, or a reduction (`{count}`). `said`
   * is the line the caller asked, which this member's answer is shaped by
   * when it was asked only a part of it. Throws to refuse. */
  read: (
    line: string,
    opts?: { said?: string; live?: boolean },
  ) => Promise<unknown>
  /** The batch as applied; `check` rehearses it and keeps nothing. */
  apply: (bundles: Bundle[], check: boolean) => Promise<Bundle[]>
  /** The words this member declares as its own. */
  vocab: () => Promise<VocabDoc>
  /** A copy that takes only the writes aimed at it. */
  sandboxed?: boolean
  /** A graph other than the caller's own, such as another host: a bundle
   * wearing any piece of it says so in `_stores`, and names it as the home of
   * `entity` when the spine came from it, since a `num` is its store's own. */
  remote?: boolean
}

/** Where a bundle's `entity`, and so its `num`, lives when that is a remote
 * member rather than the caller's own graph (`_stores.entity`). A `num` is
 * its store's own, so one from elsewhere is shown with its home.
 *
 * ```ts
 * import { homeOf } from '@yaks/reach'
 * import { assertEquals } from '@std/assert'
 *
 * let eid = 'a3f19c02-4b00-4000-8000-000000000001'
 * assertEquals(
 *   homeOf({ entity: { eid, num: 12 }, _stores: { entity: 'yaks.app' } }),
 *   'yaks.app',
 * )
 * assertEquals(homeOf({ entity: { eid, num: 5 } }), undefined)
 * ```
 */
export let homeOf = (b: Bundle): string | undefined => {
  let at = (b._stores as Record<string, unknown> | undefined)?.entity
  return typeof at == 'string' ? at : undefined
}

/** The language every member shares, and how the composition reports. */
export type Words = {
  /** The words every member speaks. A word outside it was declared by a
   * member, which makes it the most specific thing said about a row. */
  core: Vocab
  /** The members' own words as one vocabulary: `defs` is each word once,
   * from its first declarer, and `docs` is every member's document. Defaults
   * to `core` with `defs` beneath it. */
  union?: (defs: Record<string, PropSchema>, docs: VocabDoc[]) => Vocab
  /** Whether a member's answer to `line` leaves `comp` off (a listing rule's
   * stamps), so a component fetched only to order by leaves with it. */
  hidden?: (comp: string, line: string) => boolean
  /** A member left out of a read because it refused or failed. */
  silent?: (error: unknown, member: Member) => void
}

/** A refusal of the caller's own line. */
let refuse = (text: string) => new CallError('arguments', text)

// A member answering 503 is not one with nothing to say: the caller is told,
// and asks again.
let down = (e: unknown) =>
  e != null && typeof e == 'object' && 'status' in e && e.status === 503

// An error a vocabulary raised reading the caller's line is that line refused.
let refusing = (e: unknown) =>
  status(e) < 500 ? refuse((e as Error).message) : e

// The words a dotted segment can open with that belong to the whole line: the
// grammar's own riders, its aggregates, and the spine every member's entities
// share (`.entity.eid=`, which is what `id=` becomes). `.edges`, a retired
// rider that parses to nothing, is still the line's rather than a component.
// Everything else after a dot is a component, and it is the segment's part.
let RIDERS = ['order', 'near', 'limit', 'after', 'edges', 'kind', 'fields']
let AGGS = ['count', 'distinct', 'tally']
let LINE = ['entity', ...RIDERS, ...AGGS]

let firstWord = (seg: string) => /^[.!?]([a-z0-9_]+)/i.exec(seg)?.[1] ?? ''

// The part a segment belongs to: the component it names, or '' for a segment
// that is the whole line's business — `id=`, `limit=`, a bare word, a rider.
let partOf = (seg: string) => {
  if (!/^[.!?]/.test(seg)) return ''
  let word = firstWord(seg)
  return LINE.includes(word) ? '' : word
}

// Groups and quoted values stay whole. An OR run also stays one part: its
// alternatives are asked together, rather than intersected as separate parts.
let segsOf = (line: string): string[] => {
  let segs: string[] = []
  for (let tok of tokens(bareLine(line))) {
    let last = segs.length - 1
    if (last >= 0 && (tok == '|' || segs[last].endsWith('|'))) {
      segs[last] += tok
    } else segs.push(tok)
  }
  return segs
}

let aggOf = (line: string) =>
  segsOf(line).map(firstWord).find((w) => AGGS.includes(w))

let limitOf = (line: string) =>
  Number(segsOf(line).find((s) => /^\.?limit=/.test(s))?.split('=')[1]) ||
  undefined

// Does this line ask for every component? `*` is a directive in the grammar
// (@yaks/query), not a word cut out of the line, so this asks the parser
// rather than the text, the same question @yaks/graph `wanted` asks. A line
// handed over in pieces need not parse; one that does not asks for nothing
// wider than what it named.
let every = (line: string) => {
  try {
    return parse(line).clauses.some((c) => c.kind == 'every')
  } catch {
    return false
  }
}

// The directives that settle a sequence rather than a set. An `.order=` moves
// that decision past the merge: the property it names may be a word only
// another member speaks, so no member can be asked to sort by it, and none may
// cut its answer short, or the rows the order wanted would be gone before the
// merge saw them. So when the caller asks for an order, these leave the
// per-member lines and @yaks/match settles them once, over the merged bundles.
let ORDERS = ['order', 'limit', 'after']

let orderWord = (seg: string) => {
  let w = /^\.([a-z0-9_]+)=/i.exec(seg)?.[1] ?? ''
  return ORDERS.includes(w) ? w : ''
}

type Window = { segs: string[]; order: boolean }

let window = (line: string): Window => {
  let segs = segsOf(line).filter(orderWord)
  return { segs, order: segs.some((s) => orderWord(s) == 'order') }
}

// The order and its window, over the merged bundles, in the union's words.
// @yaks/match evaluates the same grammar a store compiles to SQL, so a line
// ordered here and one ordered in one member agree. A directive this
// vocabulary cannot answer exactly refuses the caller's line, as a single
// member would: an answer quietly in some other order would be worse.
let sorting = (
  orders: Window,
  vocab: Vocab,
): (bundles: Bundle[]) => Bundle[] => {
  if (!orders.order) return (bundles) => bundles
  try {
    return matcher(orders.segs.join('&'), vocab)
  } catch (e) {
    throw refusing(e)
  }
}

// The component an order reads. A store sorts by a column it never answers,
// but the merge can only sort what it holds, so this rides the gather whether
// or not the caller asked to see it, and leaves before the answer does
// (`unasked`).
let orderedBy = (orders: Window, vocab: Vocab): string | null => {
  let seg = orders.segs.find((s) => orderWord(s) == 'order')
  let path = seg?.slice(seg.indexOf('=') + 1).replace(/^-/, '')
  return path ? vocab.aim(path)[0]?.comp ?? null : null
}

/** A filter line cut into parts: the segments that name each component, and
 * the ones that ride with every part. A part whose every segment is a request
 * (`?loan`) narrows nothing: it asks for the component, so it is fetched and
 * never intersected.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let { parts, global } = split('.book&?loan&.limit=5')
 * assertEquals([...parts.keys()], ['book', 'loan'])
 * assertEquals(parts.get('loan')?.asks, true)
 * assertEquals(global, ['.limit=5'])
 * ```
 */
export let split = (line: string): {
  parts: Map<string, { segs: string[]; asks: boolean }>
  global: string[]
} => {
  let parts = new Map<string, { segs: string[]; asks: boolean }>()
  let global: string[] = []
  for (let seg of segsOf(line)) {
    let key = partOf(seg)
    if (!key) global.push(seg)
    else {
      let one = parts.get(key) ?? { segs: [], asks: true }
      one.segs.push(seg)
      one.asks &&= seg.startsWith('?')
      parts.set(key, one)
    }
  }
  return { parts, global }
}

/** Whether a line names a word another member keeps (`uses`, word → its
 * home), which one member cannot answer alone.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(borrows('.fire&?doc', { fire: 'probe' }), true)
 * assertEquals(borrows('.doc&.limit=5', { fire: 'probe' }), false)
 * assertEquals(borrows('.constructor', {}), false)
 * ```
 */
export let borrows = (
  line: string,
  uses: Record<string, string>,
): boolean =>
  [...split(line).parts.keys()].some((name) => Object.hasOwn(uses, name))

let eidOf = (b: Bundle) => b.entity?.eid ?? ''

type Heard = { at: string; bundles: Bundle[] }

// The ranking a text query painted on its hits (a query-only `rank`), kept
// off the candidate rows: the composing read addresses eids and carries no
// text pred, so the snippet and the score would be lost between the two
// halves of one search.
let ranksIn = (heard: Heard[]) => {
  let ranks = new Map<string, unknown>()
  for (let h of heard) {
    for (let b of h.bundles) {
      if (b.rank && !ranks.has(eidOf(b))) ranks.set(eidOf(b), b.rank)
    }
  }
  return ranks
}

// The eids one fan-out selects, in the order the answer keeps. Ranked hits
// interleave: a score is one member's own measure and means nothing beside
// another's, so the merge takes each member's best, then each one's second,
// the only ordering they all agree with. Everything else is member by member,
// each in its own order.
let ordered = (heard: Heard[]) => {
  let lists = heard.map((h) => h.bundles)
  let ranked = lists.some((bundles) => bundles.some((b) => 'rank' in b))
  let out: string[] = []
  if (ranked) {
    for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
      for (let bundles of lists) if (bundles[i]) out.push(eidOf(bundles[i]))
    }
  } else for (let bundles of lists) for (let b of bundles) out.push(eidOf(b))
  return [...new Set(out.filter(Boolean))]
}

// One component's properties as its schema declares them: property → the type
// word, which is all a disagreement is read out of.
let propsOf = (schema: PropSchema): Record<string, string> =>
  Object.fromEntries(
    Object.entries(schema.properties ?? {}).map((
      [prop, p],
    ) => [prop, p.enum ? p.enum.join('|') : String(p.type ?? '?')]),
  )

let spaceOf = (m: Member) => m.space ?? m.at

// Where one name means two things: the same word declared in two spaces with
// a property they spell differently. Within a space a word has one home and
// the other members use it, so a disagreement can only be across spaces, and
// there the name is two words. Properties only one side declares agree by
// construction: a vocabulary only ever grows.
let apartIn = (vocabs: { m: Member; doc: VocabDoc }[]): Set<string> => {
  let seen = new Map<string, Map<string, Record<string, string>>>()
  for (let { m, doc } of vocabs) {
    for (let [name, schema] of Object.entries(doc.$defs ?? {})) {
      let by = seen.get(name) ?? new Map()
      seen.set(name, by)
      by.set(spaceOf(m), { ...by.get(spaceOf(m)), ...propsOf(schema) })
    }
  }
  let apart = new Set<string>()
  for (let [name, by] of seen) {
    let sides = [...by.values()]
    for (let i = 0; i < sides.length; i++) {
      for (let j = i + 1; j < sides.length; j++) {
        for (let [prop, type] of Object.entries(sides[i])) {
          if (sides[j][prop] && sides[j][prop] != type) apart.add(name)
        }
      }
    }
  }
  return apart
}

type Held = {
  // The spine as the first member that answered gave it: the eid is what the
  // entity is called everywhere.
  entity: Entity
  comps: Record<string, unknown>
  // The kind each member called the row, by the member that said it.
  kinds: Record<string, string>
  // The archetype each member assigned the row: a pointer at the tables that
  // member holds, so the composition answers one of them, never a merge.
  arch: Record<string, string>
  // The member each component came from, which a write routes by.
  home: Record<string, string>
  // Where each component is said to live (`_stores`): its member, or within
  // it where a member composed of others says so in its own `_stores`. The
  // spine's is `entity`, and only when its `num` is a remote member's.
  where: Record<string, string>
  // A word two spaces mean two things by (`apartIn`), held per space instead
  // of merged: space → the member that has it and what it holds.
  split: Record<
    string,
    Record<string, { at: string; where: string; comp: unknown }>
  >
}

// `_stores`, on a bundle that must say where it lives: its pieces live in
// more than one place, or its number is a remote member's (`entity`).
let storesOf = (where: Record<string, string>) =>
  where.entity || new Set(Object.values(where)).size > 1
    ? { _stores: where }
    : {}

/** What the caller asked, which the gather would otherwise lose: the
 * components the answer keeps (`want`), the words two spaces mean two things
 * by (`apart`), the line a member's answer is shaped by (`said`), and the
 * words the filter required (`must`), which is what names the kind. */
export type Ask = {
  want?: Set<string> | null
  apart?: Set<string>
  said?: string
  must?: string[]
  live?: boolean
}

/** Which members declare which word, the words two spaces mean two things
 * by, and the union of every member's words. */
export type Spoken = {
  words: Map<string, Member[]>
  apart: Set<string>
  vocab: Vocab
}

/** A write cut into one part per member it lands in, and the eid each
 * `$alias` was given. */
export type Routed = {
  parts: { member: Member; entities: Bundle[] }[]
  aliases: Record<string, string>
}

/** The operations every set of members is asked through. */
export type Reach = {
  read: (members: Member[], line: string, live?: boolean) => Promise<unknown>
  composed: (members: Member[], eids: string[], ask?: Ask) => Promise<Bundle[]>
  routed: (
    members: Member[],
    named: Member | undefined,
    bundles: Bundle[],
    key?: string,
  ) => Promise<Routed>
  written: (
    members: Member[],
    named: Member | undefined,
    bundles: Bundle[],
    opts?: { key?: string; check?: boolean },
  ) => Promise<{
    bundles: Bundle[]
    aliases: Record<string, string>
    where: string
  }>
  spoken: (members: Member[]) => Promise<Spoken>
}

/** A composition over a shared language: the operations every set of
 * members is asked through. */
export let reach = (words: Words): Reach => {
  let { core, hidden = () => false, silent = () => {} } = words
  let union = words.union ??
    ((defs: Record<string, PropSchema>) =>
      loadVocab([...core.docs, { title: 'space', $defs: defs }]))

  // One line, asked of every member at once. One that refuses contributes
  // nothing (the word is another's, or this one is not the caller's to read),
  // but a line every member refuses is a line nobody can answer, and then the
  // first member's refusal is what the caller reads.
  let asked = async (
    members: Member[],
    line: string,
    said?: string,
    live = false,
  ): Promise<Heard[]> => {
    let tried = await Promise.all(members.map(async (m) => {
      try {
        let out = await m.read(line, { said, live })
        return {
          at: m.at,
          bundles: (Array.isArray(out) ? out : []) as Bundle[],
        }
      } catch (e) {
        // A member left out of the merge is a quieter answer, never a silent
        // one; one answering 503 is not left out at all.
        silent(e, m)
        return { at: m.at, why: e }
      }
    }))
    let gone = tried.find((t) => 'why' in t && down(t.why)) as
      | { why: unknown }
      | undefined
    if (gone) throw gone.why
    let heard = tried.filter((t) => 'bundles' in t) as Heard[]
    if (!heard.length && tried.length) {
      throw (tried[0] as { why: unknown }).why
    }
    return heard
  }

  // A member's own word is the most specific thing said about a row, wherever
  // it was said (@yaks/vocab kindOf), so a member's kind outranks a core kind
  // from another, and the union decides the rest. Between two members' words
  // the filter decides, and `must` names the components it required:
  // `?loan&.book` asks for books, so a book is what each answer is. `at` is
  // the member whose word won, whose archetype the composed bundle carries.
  let kindFrom = (
    kinds: [string, string][],
    comps: Record<string, unknown>,
    must: string[] = [],
  ): { kind: string; at?: string } => {
    let own = kinds.filter(([, k]) => k && !core.kinds.includes(k))
    let said = own.find(([, k]) => must.includes(k)) ?? own[0]
    return {
      kind: said?.[1] ?? core.kinds.find((k) => k in comps) ?? 'entity',
      at: said?.[0] ?? kinds[0]?.[0],
    }
  }

  // What every member holds about these eids, gathered in one fan-out: the
  // components, the kind each member called the row, and where each component
  // lives. The read composes bundles out of it; the write routes by it.
  // `apart` names the words kept per space rather than merged, because one
  // name meaning two things is two answers, not one bundle.
  let gathered = async (
    members: Member[],
    eids: string[],
    apart: Set<string> = new Set(),
    said?: string,
    live = false,
  ) => {
    let held = new Map<string, Held>()
    if (!eids.length) return held
    let spaces = new Map(members.map((m) => [m.at, spaceOf(m)]))
    let remote = new Set(members.filter((m) => m.remote).map((m) => m.at))
    let heard = await asked(
      members,
      `.entity.eid=${eids.join(',')}`,
      said,
      live,
    )
    for (let { at, bundles } of heard) {
      for (let row of bundles) {
        let eid = eidOf(row)
        if (!eid) continue
        // The spine is held once, here: its archetype is the answering
        // member's and is chosen with the kind, so no merge of the components
        // may spell it a second time.
        let { archetype, ...spine } = row.entity
        // A member composed of others (yaks.app across its stores) says
        // where within it each piece lives, which is said here within it.
        let inner = (row._stores ?? {}) as Record<string, string>
        let within = (name: string) => inner[name] ? `${at}/${inner[name]}` : at
        let one = held.get(eid)
        if (!one) {
          one = {
            entity: spine,
            comps: {},
            kinds: {},
            arch: {},
            home: {},
            where: {},
            split: {},
          }
          if (remote.has(at) || inner.entity) {
            one.where.entity = within('entity')
          }
          held.set(eid, one)
        }
        if (archetype != null) one.arch[at] ??= archetype
        for (let [name, comp] of Object.entries(row)) {
          if (name == 'kind' || name == 'entity' || name == '_stores') continue
          if (apart.has(name)) {
            one.split[name] ??= {}
            one.split[name][spaces.get(at) ?? at] ??= {
              at,
              where: within(name),
              comp,
            }
            continue
          }
          if (name in one.comps) continue
          one.comps[name] = comp
          one.home[name] = at
          one.where[name] = within(name)
        }
        one.kinds[at] ??= String(row.kind ?? '')
      }
    }
    return held
  }

  /** One bundle per eid, out of every member that holds a piece of it. The
   * first member that answers a component owns it here; `entity` is the
   * first member's, whose archetype comes from the member whose word named
   * the kind. `_stores` says which member holds which component, and rides
   * on a bundle that spans two or wears a remote member's piece; it names
   * `entity` too when the spine, and so the `num`, is a remote member's. */
  let composed = async (
    members: Member[],
    eids: string[],
    ask: Ask = {},
  ): Promise<Bundle[]> => {
    let { want = null, apart = new Set<string>(), said, must, live = false } =
      ask
    let spaces = new Map(members.map((m) => [m.at, spaceOf(m)]))
    let held = await gathered(members, eids, apart, said, live)
    let keeps = (name: string) => !want || want.has(name)
    let bundle = (
      one: Held,
      extra: Record<string, unknown>,
      home: Record<string, string>,
      space?: string,
    ): Bundle => {
      let comps = Object.fromEntries([
        ...Object.entries(one.comps).filter(([n]) => keeps(n)),
        ...Object.entries(extra).filter(([n]) => keeps(n)),
      ])
      let where = Object.fromEntries(
        Object.entries({ ...one.where, ...home }).filter(([n]) =>
          n == 'entity' || keeps(n)
        ),
      )
      let said = kindFrom(
        Object.entries(one.kinds).filter(([at]) =>
          !space || spaces.get(at) == space
        ),
        comps,
        must,
      )
      let archetype = said.at ? one.arch[said.at] : undefined
      return {
        kind: said.kind,
        entity: archetype ? { ...one.entity, archetype } : one.entity,
        // Two spaces mean two things by this word, so the row says which one
        // it is answering for.
        ...(space ? { space } : {}),
        ...comps,
        ...storesOf(where),
      }
    }
    let parted = (one: Held, space?: string) => {
      let mine = Object.entries(one.split).flatMap(([n, by]) =>
        space
          ? by[space] ? [[n, by[space]] as const] : []
          : Object.values(by).map((h) => [n, h] as const)
      )
      return bundle(
        one,
        Object.fromEntries(mine.map(([n, h]) => [n, h.comp])),
        Object.fromEntries(mine.map(([n, h]) => [n, h.where])),
        space,
      )
    }
    return eids.filter((e) => held.has(e)).flatMap((eid) => {
      let one = held.get(eid)!
      // The spaces this entity wears a disputed word in. None, and the bundle
      // is one; two, and it is one per space: the same eid, answered twice,
      // because the name is not one word.
      let spaces = [
        ...new Set(
          Object.entries(one.split).filter(([n]) => keeps(n))
            .flatMap(([, by]) => Object.keys(by)),
        ),
      ]
      return spaces.length < 2
        ? [parted(one)]
        : spaces.map((space) => parted(one, space))
    })
  }

  // Every word in reach as one vocabulary: the core plus each member's own. A
  // word two members declare is loaded once, from its first declarer: a word
  // has one home, and @yaks/vocab refuses a name declared twice.
  let unioned = (docs: VocabDoc[]): Vocab => {
    let defs: Record<string, PropSchema> = {}
    for (let doc of docs) {
      for (let [name, schema] of Object.entries(doc.$defs ?? {})) {
        if (name in defs || core.all.includes(name)) continue
        defs[name] = schema
      }
    }
    return union(defs, docs)
  }

  /** Which members declare which word, in member order, so the first
   * declarer is the word's home; the words two spaces mean two things by
   * (`apart`); and the union of every member's words (`vocab`).
   *
   * A core word is nobody's: a member that held it before the core said it
   * keeps it in its own graph, but every other member speaks the core's, so
   * it is not that member's to home. */
  let spoken = async (members: Member[]): Promise<Spoken> => {
    let own = await Promise.all(
      members.map(async (m) => ({ m, doc: await m.vocab() })),
    )
    let words = new Map<string, Member[]>()
    for (let { m, doc } of own) {
      for (let w of Object.keys(doc.$defs ?? {})) {
        if (core.all.includes(w)) continue
        words.set(w, [...(words.get(w) ?? []), m])
      }
    }
    return {
      words,
      apart: apartIn(own),
      vocab: unioned(own.map((o) => o.doc)),
    }
  }

  // The line's `.fields` projection in the union's words, or none. A path
  // those words cannot read is the caller's line refused, as a member
  // refuses it.
  let planned = (line: string, vocab: Vocab): Projection | null => {
    try {
      return projection(vocab, bareLine(line))
    } catch (e) {
      throw refusing(e)
    }
  }

  // A `.fields` projection over the merge. The members chose the entities and
  // the merge holds them whole, so each entity a path reaches is gathered
  // here, hop by hop and from every member, and the paths are read off the
  // lot the way a store reads them off its own rows.
  let projected = async (
    members: Member[],
    vocab: Vocab,
    p: Projection,
    found: Bundle[],
    live: boolean,
  ): Promise<Bundle[]> => {
    if (!found.length) return []
    let held = new Map(found.map((b) => [eidOf(b), b]))
    let read = rows({
      kind: 'and',
      clauses: [
        ...parse(`.entity.eid=${[...held.keys()].join(',')}`).clauses,
        ...p.query.clauses.filter((c) => c.kind == 'fields'),
      ],
    }, vocab)
    let seen = new Set(held.keys())
    while (true) {
      let got = read([...held.values()])
      let more = [...new Set(got.flatMap((r) => p.reaches.map((c) => r[c])))]
        .filter((e): e is string => typeof e == 'string' && !seen.has(e))
      if (!more.length) {
        return flat(p.fold(got)).map((b) => {
          let kind = held.get(eidOf(b))?.kind
          return kind ? { kind, ...b } : b
        })
      }
      for (let e of more) seen.add(e)
      for (let b of await composed(members, more, { live })) {
        held.set(eidOf(b), b)
      }
    }
  }

  // A component off a merged bundle the caller's own line would not carry:
  // one it did not name when it named any (@yaks/graph `wanted`), or one the
  // members' answers leave off unless named (`hidden`).
  let unasked = (comp: string, want: Set<string> | null, line: string) => {
    let kept = (want ? want.has(comp) : true) && !hidden(comp, line)
    return (b: Bundle): Bundle => {
      if (kept) return b
      let out: Bundle = { ...b }
      let homes = Object.entries((b._stores ?? {}) as Record<string, string>)
        .filter(([name]) => name != comp)
      delete out[comp]
      delete out._stores
      return { ...out, ...storesOf(Object.fromEntries(homes)) }
    }
  }

  /** The read, whole. One member and this is that member's own answer,
   * untouched. Several, and the line is split, each part asked of the members
   * that speak it, the eids in common taken (a filter's `&` is an
   * intersection), and the bundles composed.
   *
   * A window is the one place the split shows: `limit=` bounds each part
   * before the parts meet. Unless the caller asked for an order, and then the
   * sequence is nobody's to cut until the bundles are one: the order and the
   * window run over the merged answer, in the union's words. */
  let read = async (
    members: Member[],
    line: string,
    live = false,
  ): Promise<unknown> => {
    if (members.length == 1) return await members[0].read(line, { live })
    let agg = aggOf(line)
    if (agg && agg != 'count') {
      throw refuse(
        `a ${agg} reads one app at a time and this reads them all — ask for ` +
          'the rows and reduce them',
      )
    }
    let { parts, global } = split(line)
    let orders = window(line)
    // A projection is read off the merge (`projected`), so the members are
    // asked only which entities the filter selects.
    let plain = global.filter((s) =>
      !AGGS.includes(firstWord(s)) && !(orders.order && orderWord(s)) &&
      firstWord(s) != 'fields'
    )
    // Which members a word is asked of: the ones whose vocabulary declares
    // it, and every member for a word nobody declares, which is the core's
    // and spoken everywhere.
    let { words, apart, vocab } = await spoken(members)
    let sorted = sorting(orders, vocab)
    let p = planned(line, vocab)
    let speak = (name: string) => words.get(name) ?? members
    let need = [...parts].filter(([, part]) => !part.asks)
    let lines: [Member[], string][] = need.length
      ? need.map((
        [name, part],
      ) => [speak(name), [...part.segs, ...plain].join('&')])
      : [[members, plain.join('&')]]
    let ranks = new Map<string, unknown>()
    let sets = await Promise.all(
      lines.map(async ([who, one]) => {
        let heard = await asked(who, one, undefined, live)
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
    // The window is cut here only while the sequence is already settled. An
    // order moves that decision past the merge, so every candidate is
    // gathered and `sorted` cuts.
    if (!orders.order && limit != null && eids.length > limit) {
      eids = eids.slice(0, limit)
    }
    // `.count` over a fan-out is how many entities the filter selects:
    // summing each member's own count would count an entity two hold twice.
    if (agg == 'count') return { count: eids.length }
    // The bundle is read from the members that speak a word the line named,
    // and carries those components (@yaks/graph `wanted`). A part this cannot
    // confirm is a component asks for the whole bundle rather than guess, and
    // `*` is the grammar's widest projection. A `.fields` projection reads
    // its properties off the whole merge, wherever they live.
    let named = [...parts.keys()]
    let want = named.length && !every(line) && !p &&
        named.every((n) => words.has(n) || core.all.includes(n))
      ? new Set(named)
      : null
    // In reach order, whatever order the line names its words in: the first
    // member holding the entity gives its spine, and so its `num`.
    let by = orderedBy(orders, vocab)
    let asks = new Set([...named, ...(by ? [by] : [])].flatMap(speak))
    let from = named.length && !p ? members.filter((m) => asks.has(m)) : members
    let bundles = await composed(
      from,
      eids,
      {
        want: want && by ? new Set([...want, by]) : want,
        apart,
        said: by ? `${line}&?${by}` : line,
        must: need.map(([name]) => name),
        live,
      },
    )
    let out = sorted(
      bundles.map((b) => {
        let rank = ranks.get(eidOf(b))
        return rank ? { ...b, rank } : b
      }),
    )
    if (p) return await projected(members, vocab, p, out, live)
    return by ? out.map(unasked(by, want, line)) : out
  }

  /** The batch, split by component into one part per member, with every
   * `$alias` minted once for all of them. `key` derives the mints, so the
   * same batch sent again mints the same eids. */
  let routed = async (
    members: Member[],
    named: Member | undefined,
    bundles: Bundle[],
    key?: string,
  ): Promise<Routed> => {
    // A sandboxed copy owns only writes aimed at it, and a write aimed at a
    // member stays in its space: spaces share no home, so another space's
    // declarer, holder or mate is never where a part goes. Every routing
    // decision chooses from the same eligible members.
    members = members.filter((m) =>
      (!m.sandboxed || m == named) &&
      (!named || spaceOf(m) == spaceOf(named))
    )
    let { words, apart, vocab } = await spoken(members)
    let { entities, eids, aliases } = minted(bundles, vocab, key)
    // Where the entity already lives, read only when the answer depends on
    // it: a death fans out to whoever holds the eid, and a shared word with no
    // member named goes to the one that already wears it.
    let asking = entities.flatMap((e, i) =>
      eids[i] && (dead(e) ||
          (!named && Object.keys(e).some((k) => isComp(k) && !words.has(k))))
        ? [eids[i]!]
        : []
    )
    let held = await gathered(members, asking)
    let by = (label: string) => members.find((m) => m.at == label)
    let slugs = () => members.map((m) => m.name ?? m.at).join(', ')
    // The one member a bundle that cannot be split goes to.
    let only = () => {
      if (named) return named
      if (members.length == 1) return members[0]
      throw refuse(`name the app this goes in with $app — ${slugs()}`)
    }
    let home = (name: string, eid: string | null, mates: Member[]): Member => {
      let declared = words.get(name) ?? []
      let mine = eid ? held.get(eid)?.home ?? {} : {}
      if (declared.length) {
        // A word has one home: the first member to declare it. A second
        // member declaring the same word is a use of it, and its writes land
        // in the home. Where the entity already wears the word wins over
        // birth order, and a named member wins over both when it is one of
        // the declarers, since across spaces two members may mean two things
        // by one name.
        let where = mine[name] && by(mine[name])
        if (where && declared.includes(where)) return where
        if (named && declared.includes(named)) return named
        // Across spaces the shapes may disagree, and then the name is two
        // words: nothing here can pick between them, so the caller does.
        let spaces = [...new Set(declared.map(spaceOf))]
        if (apart.has(name) && spaces.length > 1) {
          throw refuse(
            `${name} means two things — ${spaces.join(' and ')} declare it ` +
              'differently; say which with $app on the bundle',
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
      // nowhere else to go rides with the member whose own words are in the
      // same bundle, which is what makes writing a new entity one call.
      if (mates.length == 1) return mates[0]
      if (members.length == 1) return members[0]
      throw refuse(
        `which app should ${name} go in? say $app on the bundle — ${slugs()}`,
      )
    }
    let parts = new Map<Member, Bundle[]>()
    let add = (m: Member, e: Bundle) =>
      parts.set(m, [...(parts.get(m) ?? []), e])
    for (let [i, e] of entities.entries()) {
      let eid = eids[i]
      if (!eid) {
        add(only(), e)
        continue
      }
      // Death is the whole entity's, so it goes wherever the entity is: every
      // member holding a piece of it, and the one named when none does yet.
      if (dead(e)) {
        let holders = [...new Set(Object.values(held.get(eid)?.home ?? {}))]
          .map(by).filter(Boolean) as Member[]
        for (let m of holders.length ? holders : [only()]) {
          add(m, { entity: { eid }, tombstone: {} })
        }
        continue
      }
      // A `$was` guard rides with the component it guards, whether or not
      // this batch also writes that component: a precondition that lost its
      // part would silently stop guarding.
      let guards = (e.$was ?? {}) as Record<string, unknown>
      let names = [
        ...new Set([...Object.keys(e).filter(isComp), ...Object.keys(guards)]),
      ]
      let mine = new Map<Member, string[]>()
      let take = (m: Member, name: string) =>
        mine.set(m, [...(mine.get(m) ?? []), name])
      // The members' own words first: they are what a shared word rides with.
      for (let name of names.filter((n) => words.has(n))) {
        take(home(name, eid, []), name)
      }
      let mates = [...mine.keys()]
      for (let name of names.filter((n) => !words.has(n))) {
        take(home(name, eid, mates), name)
      }
      for (let [m, keys] of mine) {
        let was = Object.fromEntries(
          Object.entries(guards).filter(([n]) => keys.includes(n)),
        )
        add(m, {
          entity: { ...e.entity, eid },
          ...Object.fromEntries(
            keys.filter((n) => n in e)
              .map((n) => [n, (e as Record<string, unknown>)[n]]),
          ),
          ...(Object.keys(was).length ? { $was: was } : {}),
          // and the alias the caller named it by, which every part carries:
          // it is how a store tells an id this picked from one the caller
          // wrote down (@yaks/alias).
          ...(typeof e.$alias == 'string' ? { $alias: e.$alias } : {}),
        } as Bundle)
      }
    }
    return {
      parts: [...parts].map(([member, entities]) => ({ member, entities })),
      aliases,
    }
  }

  /** The write, whole: routed, rehearsed in every member, then committed. A
   * refusal in any member leaves every other unwritten, because the rehearsal
   * went first; a single part needs no second round trip, since its commit is
   * its rehearsal. A refusal after the rehearsal may follow another part's
   * commit, so it comes back marked `partial`: the caller must not send the
   * batch again. `check` stops at the rehearsal, which is then the answer. */
  let written = async (
    members: Member[],
    named: Member | undefined,
    bundles: Bundle[],
    opts: { key?: string; check?: boolean } = {},
  ): Promise<{
    bundles: Bundle[]
    aliases: Record<string, string>
    where: string
  }> => {
    let { key, check = false } = opts
    let { parts, aliases } = await routed(members, named, bundles, key)
    if (!parts.length) throw refuse('entities: nothing to write')
    if (parts.length > 1 && !check) {
      await Promise.all(parts.map((p) => p.member.apply(p.entities, true)))
    }
    let outs = await Promise.all(
      parts.map((p) => p.member.apply(p.entities, check)),
    ).catch((e) => {
      throw parts.length > 1 && !check ? Object.assign(e, { partial: true }) : e
    })
    let applied = outs.flat()
    // Where a `$alias` landed. A member may put a bundle somewhere other than
    // the id minted for it: one carrying a name somebody already holds is a
    // patch of that entity (@yaks/alias), and the batch as applied says so.
    for (let b of applied) {
      if (typeof b.$alias == 'string') aliases[b.$alias] = b.entity.eid
    }
    return {
      bundles: applied,
      aliases,
      where: parts.map((p) => p.member.at).join(' and '),
    }
  }

  return { read, composed, routed, written, spoken }
}

// The keys of a bundle that name no component: its address and its death.
// Everything a `$` opens is the wire's own (`$was`, `$delete`, `$actor`).
let NOT_A_COMP = ['entity', 'tombstone']

let isComp = (k: string) => !NOT_A_COMP.includes(k) && !k.startsWith('$')

// Every `$alias` in the batch, minted here. A bundle that lands in two members
// must land under one eid, so content-addressed ids are derived by the same
// rules as a store, the rest are minted, and every member gets the one
// answer. A bundle with no address at all is minted the same way.
let minted = (bundles: Bundle[], vocab: Vocab, key?: string) => {
  let ordinal = 0
  let mint = () =>
    key
      ? derivedEid(JSON.stringify(['outbox', key, ordinal++]))
      : crypto.randomUUID()
  let stated = bundles.map((e) => {
    let eid = e.entity?.eid
    if (typeof eid == 'string') return e
    // An eid is the only address that holds across members: a num is one
    // store's, so a bundle naming one names nothing here, and minting an eid
    // for it would write a new entity where the caller meant an existing one.
    if (e.entity?.num != null) {
      throw refuse(
        'entity.num addresses nothing here — name the entity by its eid',
      )
    }
    return { ...e, entity: { ...e.entity, eid: mint() } }
  })
  let derive = {
    ...identities(vocab),
    ...(vocab.comp('archetype') ? archetypes().derive : {}),
    ...edges(vocab).derive,
    ...keys(vocab).derive,
  }
  let resolved = resolve(stated, vocab, derive, mint)
  let aliases = Object.fromEntries(
    resolved.flatMap((e) =>
      typeof e.$alias == 'string' ? [[e.$alias, e.entity.eid]] : []
    ),
  )
  let eids = resolved.map((e) => e.entity.eid)
  // An alias stands wherever an eid goes (a ref property, an edge's end, a
  // nested bundle's address), so the swap is the whole batch's, by value.
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
  let entities = stated.map((e, i) => {
    let one = swap(e) as Bundle
    if (!eids[i]) return one
    // The alias rides along. A store's own mint phase reads `$alias` to tell
    // an id the graph picked from one a caller wrote down, which decides
    // whether a name somebody already holds moves this entity onto theirs or
    // is refused as a clash.
    let said = e.entity?.eid
    return {
      ...one,
      entity: { ...one.entity, eid: eids[i]! },
      ...(typeof said == 'string' && said.startsWith('$')
        ? { $alias: said }
        : {}),
    }
  })
  return { entities, eids, aliases }
}
