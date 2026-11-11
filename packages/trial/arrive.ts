/**
 * What a variant adds at a door, replayed at a case's moment, for
 * `@yaks/trial/moment` to put in front beside the persona:
 *
 * - {@link beside}: beside each of the person's words in the window, what the
 *   prompt hook recalls (@yaks/memory/earlier): their nearest earlier words,
 *   memories and decisions, at a floor for the last two.
 * - {@link related}: beside each write's hit rows, the few nearest resources
 *   of any kind (@yaks/embedding/neighbours `hit.related`), as the graph
 *   stood when the write returned.
 * - {@link said}: beside each thing the session wrote, what a write is
 *   answered with from memory (@yaks/memory/graph): the person's nearest
 *   earlier words, at a floor, and the nearest answered decisions.
 * - {@link open}: at the session's start and after each compaction, what was
 *   open with the person, and the decisions they answered in the day before.
 * - {@link drafted}: once, the few resources nearest in meaning to the agent's
 *   own words: its erring entry, its last tool call, or its last reply.
 * - {@link theirs}: the person's comments and answers of the day before on
 *   what the session's window names, by link rather than by meaning.
 * - {@link carried}: after a compaction, what the session kept of the
 *   person's words in the day before it: the memories it saved of them and
 *   the tasks it filed quoting them.
 * - {@link standing}: at the session's start and after each compaction, who
 *   the person is, and each notice that came to the session, or to the session
 *   that spawned it, more than once in the day before.
 *
 * Each reads the graph as it stands now, cut back at the moment: a row
 * created later is left out, and a body edited since reads as it does now.
 * The recall is given all the time it needs; the live hook gives it 700 ms.
 *
 * @module
 */
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { called } from '@yaks/graph/hit'
import { human, short } from '@yaks/id'
import type { Meaning } from '@yaks/host'
import { bearing, clip, earlier, titleOf } from '@yaks/memory/earlier'
import { textOf } from '@yaks/memory/graph'
import { FEW, resources } from '@yaks/embedding/neighbours'
import {
  absent,
  and,
  eq,
  every,
  gt,
  limit,
  lt,
  ne,
  near,
  order,
  present,
  stringify,
} from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Part } from './mod.ts'
import { type Arrival, asOf, type At, hits, prompt } from './moment.ts'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let at = (b: Bundle): string => str(comp(b, 'created').at)
let body = (b: Bundle): string =>
  str(comp(b, 'content').body) || str(comp(b, 'doc').body)

// The ids a recall's lines open with ("M-17952 · …"), as eids.
let named = async (g: Graph, text: string): Promise<Eid[]> => {
  let ids = [...text.matchAll(/^(\S+) · /gm)].map((m) => m[1])
  let found = await g.address(ids)
  return ids.flatMap((id) => found.get(id) ?? [])
}

/** The prompt recall beside each of the person's words, its memories and
 * decisions kept to `floor`. */
export let beside = (
  g: Graph,
  { person, meaning, floor }: {
    person: Eid
    meaning?: Meaning
    floor?: number
  },
): Arrival =>
async ({ had }) => {
  let theirs = had.filter((b) =>
    prompt(b) && comp(b, 'created').by == person && !b.notice
  )
  let parts: Part[] = []
  for (let b of theirs) {
    let text = await earlier(g, {
      person,
      words: body(b),
      before: at(b),
      meaning,
      floor,
      wait: null,
    })
    if (text) parts.push({ door: 'notice', eids: await named(g, text), text })
  }
  return parts
}

/** The related list beside each write's hit rows: the {@link FEW} nearest
 * resources of any kind to the entity it made, past the ones its own list
 * showed, none written by the session itself. Cases that share a window share
 * its writes, so each write's list is read once. */
export let related = (g: Graph): Arrival => {
  let lists = new Map<string, Promise<Bundle[]>>()
  return async ({ vocab, m, had }) => {
    let kept = resources(vocab)
    let list = async (result: Bundle, rows: Bundle[], of: Eid) => {
      let shown = new Set([of, ...rows.map((r) => r.entity.eid)])
      let found = await g.read(and(
        lt('created.at', at(result)),
        ne('created.via', m.session),
        ...kept,
        near(of),
        order('similar'),
        limit(FEW + shown.size),
        every(),
      ))
      return found.filter((b) => !shown.has(b.entity.eid)).slice(0, FEW)
    }
    let out: Bundle[] = []
    for (let result of had) {
      let rows = hits(result)
      for (let of of new Set(rows.map((r) => str(comp(r, 'hit').near)))) {
        let key = `${result.entity.eid} ${of}`
        if (!lists.has(key)) lists.set(key, list(result, rows, of))
        out.push(...await lists.get(key)!)
      }
    }
    let name = called(vocab)
    return out.length
      ? [{
        door: 'hit',
        eids: out.map((b) => b.entity.eid),
        text: out.map((b) =>
          JSON.stringify({
            id: name(b),
            kind: vocab.kindOf(b),
            title: str(comp(b, 'doc').title) || body(b).slice(0, 120),
          })
        ).join('\n'),
      }]
      : []
  }
}

/** What a write is answered with from memory, beside each thing the session
 * wrote in the window: the person's nearest earlier words at least `floor`
 * similar, and the nearest answered decisions, as the graph stood when it was
 * written. What the session was told in the window is left out, as it is
 * live. Cases that share a session share its writes, so each is read once. */
export let said = (
  g: Graph,
  { person, meaning, floor }: {
    person: Eid
    meaning?: Meaning
    floor?: number
  },
): Arrival => {
  let read = new Map<Eid, ReturnType<typeof bearing>>()
  return async ({ vocab, m, since }) => {
    let wrote = (await g.read(and(
      eq('created.via', m.session),
      gt('created.at', since),
      lt('created.at', m.at),
      absent('entry'),
      every(),
    ))).filter((b) => vocab.kindOf(b) != 'entity' && textOf(b).trim())
    let name = called(vocab)
    let eids: Eid[] = []
    let lines: string[] = []
    for (let b of wrote) {
      let key = b.entity.eid
      if (!read.has(key)) {
        read.set(
          key,
          bearing(g, {
            person,
            words: textOf(b),
            before: at(b),
            meaning,
            floor,
            held: { via: m.session, since },
            wait: null,
          }),
        )
      }
      let found = await read.get(key)!
      for (let q of found.said) {
        eids.push(q.from.entity.eid)
        lines.push(
          `${q.id} · ${q.at.slice(0, 10)} · ${JSON.stringify(clip(q.words))}`,
        )
      }
      for (let d of found.decided) {
        eids.push(d.entity.eid)
        lines.push(`${name(d)} · ${titleOf(d)}`)
      }
    }
    return lines.length ? [{ door: 'hit', eids, text: lines.join('\n') }] : []
  }
}

let DAY = 24 * 60 * 60 * 1000

/** What is open with the person at the window's start, and the decisions they
 * answered in the day before it. */
export let open =
  (person: Eid): Arrival => async ({ storage, vocab, since }) => {
    let then = asOf(storage, vocab, since)
    let day = new Date(Date.parse(since) - DAY).toISOString()
    let asks =
      (await then.read(and(eq('filed.assignee', person), present('task'))))
        .filter((b) => comp(b, 'task').status == 'open')
    let answered = (await then.read(and(
      eq('decided.by', person),
      present('decision'),
    ))).filter((b) => str(comp(b, 'decided').at) >= day)
    let rows = [...asks, ...answered]
    let name = called(vocab)
    return rows.length
      ? [{
        door: 'notice',
        eids: rows.map((b) => b.entity.eid),
        text: rows.map((b) =>
          `${name(b)} · ${str(comp(b, 'doc').title)}${
            b.decided ? ` → ${str(comp(b, 'decided').choice)}` : ''
          }`
        ).join('\n'),
      }]
      : []
  }

/** Which of the agent's own words a {@link drafted} recall is keyed on: the
 * erring entry itself (what a check of an output before it is sent sees), its
 * last tool call before it (the post-tool hook), or its last reply or
 * reasoning before it (a hook at the next prompt). */
export type Key = 'entry' | 'call' | 'reply'

/** The words an entry of the agent's says: a call's arguments as text, and
 * otherwise its body. */
export let words = (b: Bundle | undefined): string =>
  !b ? '' : b.call ? JSON.stringify(comp(b, 'call').args ?? {}) : body(b)

/** The agent's words a {@link Key} names, at a case's moment. */
export let keyed = async (
  { storage, m, had }: Pick<At, 'storage' | 'm' | 'had'>,
  key: Key,
): Promise<string> =>
  key == 'entry'
    ? words((await storage.get([m.entry]))[0])
    : words(had.findLast((b) =>
      key == 'call' ? !!b.call : !!(b.output || b.reasoning)
    ))

/** The filter line a recall at the moment is kept to: resources only (no
 * one-off entry but a person's words), created before it. */
export let durable = (vocab: Vocab, at: string): string =>
  stringify(and(lt('created.at', at), ...resources(vocab)))

/** The `few` resources nearest in meaning to the agent's words that `key`
 * names, each at least `floor` similar, as one notice of lines by id. */
export let drafted = (
  g: Graph,
  meaning: Meaning,
  { key, few = 4, floor = 0 }: { key: Key; few?: number; floor?: number },
): Arrival =>
async (at) => {
  let text = await keyed(at, key)
  if (!text.trim()) return []
  let hits = (await meaning(text, {
    within: durable(at.vocab, at.m.at),
    limit: few,
  })).filter((h) => h.similarity >= floor)
  if (!hits.length) return []
  let rows = await g.get(hits.map((h) => h.entity))
  let name = called(at.vocab)
  return [{
    door: 'notice',
    eids: rows.map((b) => b.entity.eid),
    text: rows.map((b) =>
      `${name(b)} · ${str(comp(b, 'doc').title) || body(b).slice(0, 120)}`
    ).join('\n'),
  }]
}

let dayBefore = (at: string): string =>
  new Date(Date.parse(at) - DAY).toISOString()

/** Whether the window's entries name a row: by its eid, its number under any
 * letter ("T-153687") or its short handle. */
export let naming = (had: Bundle[]): (b: Bundle) => boolean => {
  let text = had.map((b) => JSON.stringify(b)).join('\n')
  let word = (source: string) =>
    new RegExp(`(?<![\\w#-])${source}(?![\\w-])`).test(text)
  return ({ entity: { eid, num } }) =>
    word(RegExp.escape(eid)) || word(RegExp.escape(short(eid))) ||
    (num != null && word(`[A-Z]-${num}`))
}

let lines = (door: Part['door'], rows: [Bundle, string][]): Part[] =>
  rows.length
    ? [{
      door,
      eids: rows.map(([b]) => b.entity.eid),
      text: rows.map(([, line]) => line).join('\n'),
    }]
    : []

/** What the person said or answered in the day before the moment on what the
 * window names: each comment of theirs whose target the window names and that
 * it does not name itself, and each decision the window names that they
 * answered, with the choice. Read from the person's own rows of the day, so
 * it is bounded by what they wrote, not by what the session touched. Live,
 * it is the post-tool hook's: a call or a result names the row. */
export let theirs =
  (person: Eid): Arrival => async ({ storage, vocab, m, had }) => {
    let then = asOf(storage, vocab, m.at)
    let day = dayBefore(m.at)
    let names = naming(had)
    let id = human(vocab)
    let comments = await then.read(and(
      eq('created.by', person),
      present('comment'),
      gt('created.at', day),
    ))
    let targets = new Map(
      (await then.get([
        ...new Set(comments.map((c) => str(comp(c, 'comment').target))),
      ])).filter(names).map((b) => [b.entity.eid, b]),
    )
    let answered = (await then.read(and(
      eq('decided.by', person),
      present('decision'),
    ))).filter((b) => str(comp(b, 'decided').at) >= day && names(b))
    return lines('notice', [
      ...comments.flatMap((c): [Bundle, string][] => {
        let on = targets.get(str(comp(c, 'comment').target))
        return on && !names(c)
          ? [[c, `${id(c)} · on ${id(on)} · ${JSON.stringify(clip(body(c)))}`]]
          : []
      }),
      ...answered.map((d): [Bundle, string] => [d, `${id(d)} · ${titleOf(d)}`]),
    ])
  }

// Whether a body quotes words: holds a run of at least RUN of their
// characters, whitespace aside.
let RUN = 40
let flat = (s: string) => s.replace(/\s+/g, ' ').trim()
let quotes = (text: string, words: string): boolean => {
  let w = flat(words)
  for (let i = 0; i + RUN <= w.length; i += RUN / 2) {
    if (text.includes(w.slice(i, i + RUN))) return true
  }
  return false
}

/** After a compaction, what the session kept of the person's words in the
 * day before it: each of their words it saved as a memory, and each task it
 * filed that quotes words they wrote to it. The words themselves are not
 * listed: a day of them runs to thousands of tokens. Nothing when the window
 * begins at the session's start. */
export let carried =
  (person: Eid): Arrival => async ({ storage, vocab, m, had, since }) => {
    if (!had[0]?.checkpoint) return []
    let day = dayBefore(since)
    let id = human(vocab)
    let span = (prop: string) => [gt(prop, day), lt(prop, since)]
    let words = (await storage.read(and(
      eq('entry.session', m.session),
      eq('created.by', person),
      ...span('created.at'),
    ))).filter((b) => prompt(b) && !b.notice)
    let saved = await storage.read(and(
      eq('memory.via', m.session),
      eq('created.by', person),
      ...span('memory.at'),
    ))
    let filed = (await storage.read(and(
      eq('created.via', m.session),
      present('task'),
      ...span('created.at'),
    ))).filter((b) => {
      let text = flat(`${str(comp(b, 'doc').title)} ${body(b)}`)
      return words.some((w) => quotes(text, body(w)))
    })
    return lines(
      'compaction',
      [...saved, ...filed].map((b) => [
        b,
        `${id(b)} · ${titleOf(b)}`,
      ]),
    )
  }

/** At the window's start (the session's start or a compaction): who the
 * person is, and each notice that came more than once in the day before to
 * the session or to the session that spawned it, a scheduled reminder like the
 * work-pace check. One line per notice, its words as last delivered; the part
 * carries every copy of those words, which are one text. */
export let standing =
  (person: Eid): Arrival => async ({ storage, vocab, m, since }) => {
    let id = human(vocab)
    let day = dayBefore(since)
    let [session] = await storage.get([m.session])
    let from = [m.session, str(comp(session, 'spawned').parent)].filter(Boolean)
    let copies = new Map<string, Bundle[]>()
    for (let s of from) {
      for (
        let b of await storage.read(and(
          eq('entry.session', s),
          present('notice'),
          gt('created.at', day),
          lt('created.at', since),
        ))
      ) {
        let text = flat(body(b))
        if (text) copies.set(text, [...copies.get(text) ?? [], b])
      }
    }
    let [who] = await asOf(storage, vocab, since).get([person])
    let parts = lines(
      'persona',
      who ? [[who, `${id(who)} · ${titleOf(who)} · ${clip(body(who))}`]] : [],
    )
    let kept = [...copies].filter(([, rows]) => rows.length > 1)
    return kept.length
      ? [...parts, {
        door: 'notice',
        eids: kept.flatMap(([, rows]) => rows.map((b) => b.entity.eid)),
        text: kept.map(([text]) => text).join('\n'),
      }]
      : parts
  }
