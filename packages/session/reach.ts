// What a step reads of a transcript. A status, a runner step and a tool
// snapshot each decide from the newest part of a transcript and the few older
// entries that part names; reading all of it made a step cost more with every
// line the transcript had ever held (T-128248).
//
// `reach` reads newest first, a page at a time, and stops at the oldest seq
// any of those decisions still looks at: the newest ask and the boundary it
// was sent from, the turns a retry counts back through, the last stop, the
// summary a checkpoint left and everything after the line it replaced, or the
// lines a finite `sending.window` sends. Beyond that edge it adds only the
// entries those name (a call a result answers, the ask a line came from, the
// newest `using` and `sending`, the prompts a checkpoint retains), each by one
// query. What it returns answers every function of ./state.ts and ./compact.ts
// as the whole transcript would; ./reach_test.ts holds the two together.
//
// A fork reads through its segments (./window.ts): the parent up to the
// anchor, then its own. A transcript with no checkpoint and no window is its
// own context, so reaching it reads it all: the model is sent all of it too.
// Entries without a `seq` belong to the oldest end and are reached when the
// reading is.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { stoppedNotice } from './claude-control.ts'
import { askingOf, lines } from './compact.ts'
import { ASK, CALL, CONTENT, ENTRY, OUTPUT, RESULT, USING } from './native.ts'
import {
  attemptState,
  kindOf,
  ordered,
  RETRIES,
  sendingBefore,
  seqOf,
  usingBefore,
} from './state.ts'
import { type Segment, transcriptSegments, within } from './window.ts'

const SENDING = 'sending'
const PROGRESS = 'tool_progress'
const FIRST = 64

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

export type Reach = {
  /** read prose too: the lines a model is sent, their bodies in hand */
  bodies?: boolean
  /** a model turn: its context (checkpoint, prompts, window) is reached too */
  turn?: boolean
  /** the components to read of each entry; every one but prose by default */
  comps?: string[]
}

// One reading: the chain of segments and what of each entry it brings.
type Read = { g: Graph; segs: Segment[]; names?: string[]; fields: string }

let chain = async (g: Graph, session: Eid, o: Reach): Promise<Read> => {
  let names = o.bodies
    ? undefined
    : o.comps ?? g.vocab.comps.filter((n) => n != CONTENT && n != 'session')
  return {
    g,
    segs: await transcriptSegments(g, session),
    names,
    fields: names ? names.map((n) => '?' + n).join('&') : '*',
  }
}

// Older rows of the whole chain, `n` at a time, newest first.
let pages = ({ g, segs, fields }: Read) => {
  let i = segs.length - 1, after = ''
  return {
    get done() {
      return i < 0
    },
    next: async (n: number): Promise<Bundle[]> => {
      let got: Bundle[] = []
      while (i >= 0 && got.length < n) {
        let want = n - got.length
        let rows = await g.read(
          `${within(segs[i])}&.order=-entry.seq&.limit=${want}${after}` +
            `&${fields}`,
        )
        got.push(...rows)
        if (rows.length < want) {
          i--
          after = ''
        } else after = `&.after=${rows.at(-1)!.entity.eid}`
      }
      return got
    },
  }
}

// The newest entry a qualifier selects, and every one of them.
let newest = async (
  r: Read,
  qualifier: string,
): Promise<Bundle | undefined> => {
  for (let s of r.segs.toReversed()) {
    let [row] = await r.g.read(
      `${within(s)}${qualifier}&.order=-entry.seq&.limit=1&${r.fields}`,
    )
    if (row) return row
  }
}
let every = async (r: Read, qualifier: string): Promise<Bundle[]> =>
  (await Promise.all(
    r.segs.map((s) => r.g.read(`${within(s)}${qualifier}&${r.fields}`)),
  )).flat()

let fetch = async (r: Read, eids: Iterable<Eid>): Promise<Bundle[]> => {
  let ids = [...new Set(eids)]
  return ids.length
    ? (await r.g.get(ids, r.names)).filter((b) => !b.tombstone)
    : []
}

// The entries `aspectBefore` (./state.ts) reads to say what `name` is in force:
// the newest to carry it, the newest that is not an ask, and the line the
// newest ask was sent through. `near` is the newest entries already read.
let aspect = async (
  r: Read,
  name: string,
  near: Bundle[] = [],
): Promise<Bundle[]> => {
  if (!r.g.vocab.comp(name)) return []
  let carry = near.filter((b) => name in b)
  let latest = carry.at(-1) ?? await newest(r, `&.${name}`)
  if (!latest) return []
  let chosen = !latest.ask
    ? undefined
    : carry.findLast((b) => !b.ask) ?? await newest(r, `&.${name}&!${ASK}`)
  let through = comp(latest, ASK)?.through
  let sent = through == null ? [] : near.filter((b) => b.entity.eid == through)
  return [
    latest,
    ...chosen ? [chosen] : [],
    ...through == null
      ? []
      : sent.length
      ? sent
      : await fetch(r, [String(through)]),
  ]
}

/** The model selection in force on a transcript, as the whole of it would say. */
export let usingOf = async (
  g: Graph,
  session: Eid,
): Promise<Comp | undefined> =>
  usingBefore(await aspect(await chain(g, session, {}), USING))

/** Whether a transcript holds an ask. */
export let hasAsk = async (g: Graph, session: Eid): Promise<boolean> =>
  !!await newest(await chain(g, session, { comps: [ENTRY] }), `&.${ASK}`)

// What a reading holds besides its newest rows, each found by one query for
// all: the open calls (which no result answers), the asks the runner owes a
// retry, and for a model turn the checkpoints and the prompts it retains.
let named = async (r: Read, turn: boolean): Promise<Bundle[]> => {
  let has = (name: string) => r.g.vocab.comp(name)
  let parts = [
    ...turn && has('checkpoint') ? ['.checkpoint'] : [],
    ...turn && has('prompt') ? ['.prompt'] : [],
    ...has('provisional') ? [`.${ASK} .provisional`] : [],
    ...has(CALL) && has(RESULT) ? [`.${CALL} !${RESULT}s`] : [],
  ]
  return parts.length ? await every(r, `&(${parts.join('|')})`) : []
}

/** The calls of a transcript no result answers. */
export let openOf = async (g: Graph, session: Eid): Promise<Bundle[]> =>
  (await named(await chain(g, session, { comps: [ENTRY, CALL] }), false))
    .filter((b) => b.call)

// What a decision still reads, found as the rows come: the oldest seq the rows
// must reach, undefined while they cannot say.
type Needs = {
  rows: Bundle[]
  stop: () => Promise<number | undefined>
  seqAt: (eid: Eid) => Promise<number | undefined>
  mark?: number
  window: (rows: Bundle[]) => Promise<unknown>
}

let floor = async (n: Needs, turn: boolean): Promise<number | undefined> => {
  let { rows } = n
  let all = rows.filter((b) => !b.notice || stoppedNotice(b))
  let ask = all.findLast((b) => kindOf(b) == 'ask')
  let turns = all.filter((b) => b.ask || kindOf(b) == 'input')
  if (!ask || turns.length < RETRIES) return undefined
  let seqs = [seqOf(ask), seqOf(turns.at(-RETRIES)!)]
  // The newest input or stop says whether the transcript is stopped. An
  // imported stop is a notice among the lines, found only by reading them.
  let control = all.findLast((b) => ['input', 'stop'].includes(kindOf(b)!))
  if (rows.some((b) => b.imported)) {
    if (!control) return undefined
    seqs.push(seqOf(control))
  } else if (!control) {
    let stop = await n.stop()
    if (stop != null) seqs.push(stop)
  }
  let sent = async (b: Bundle) => {
    let through = comp(b, ASK)?.through
    let at = through == null ? undefined : await n.seqAt(String(through))
    if (at != null) seqs.push(at)
  }
  await sent(ask)
  if (turn) {
    let done = rows.findLast((b) => b.ask && attemptState(b) == 'completed')
    if (!done) return undefined
    seqs.push(seqOf(done))
    await sent(done)
    if (n.mark != null) seqs.push(n.mark)
    else {
      let size = Math.floor(Number(await n.window(rows)))
      if (!(size >= 1)) return -Infinity
      let said = lines(rows, askingOf(rows))
      if (said.length < size) return undefined
      let from = said.length - size
      while (from > 0 && kindOf(said[from]) != 'input') from--
      if (from == 0 && kindOf(said[0]) != 'input') return undefined
      seqs.push(seqOf(said[from]))
    }
  }
  return Math.min(...seqs)
}

let read = async (g: Graph, session: Eid, o: Reach): Promise<Bundle[]> => {
  let r = await chain(g, session, o)
  let held = await named(r, !!o.turn)
  let rows: Bundle[] = []
  let find = (eid: Eid) =>
    rows.find((b) => b.entity.eid == eid) ??
      held.find((b) => b.entity.eid == eid)
  let stop: Promise<number | undefined> | undefined
  let n: Needs = {
    rows,
    stop: () =>
      stop ??= (async () => {
        let hit = g.vocab.comp('stop') &&
          await newest({ ...r, fields: '?entry' }, '&.stop')
        return hit ? seqOf(hit) : undefined
      })(),
    seqAt: async (eid) => {
      let b = find(eid) ?? (await fetch({ ...r, names: [ENTRY] }, [eid]))[0]
      return b?.entry ? seqOf(b) : undefined
    },
    window: async (rows) =>
      sendingBefore(await aspect(r, SENDING, rows))?.window,
  }
  if (o.turn) {
    let mark = held.filter((b) => b.checkpoint).at(-1)
    if (mark) {
      let through = comp(mark, 'checkpoint')?.through
      let boundary = through == null
        ? undefined
        : await n.seqAt(String(through))
      let at = boundary ?? Number(comp(mark, 'checkpoint')?.seq)
      n.mark = Number.isSafeInteger(at) && at >= 1 ? at : -Infinity
      if (through != null) held.push(...await fetch(r, [String(through)]))
    }
  }
  let page = pages(r), size = FIRST
  while (true) {
    rows.unshift(...(await page.next(size)).reverse())
    let at = await floor(n, !!o.turn)
    if (page.done || at != null && seqOf(rows[0]) <= at) break
    size *= 2
  }
  // Older entries the rows name: what a model selection is in force, the call
  // a result answers, the ask a reply or call came from, and what the open
  // calls have reported.
  held.push(
    ...await aspect(r, USING, rows),
    ...await aspect(r, SENDING, rows),
  )
  let open = held.filter((b) => b.call).map((b) => b.entity.eid)
  if (open.length && g.vocab.comp(PROGRESS)) {
    held.push(
      ...await g.read(`.${PROGRESS}.call=${open.join(',')}&${r.fields}`),
    )
  }
  let missing = (of: (b: Bundle) => unknown) => {
    let seen = new Set([...rows, ...held].map((b) => b.entity.eid))
    return [
      ...new Set(
        [...rows, ...held].flatMap((b) => {
          let eid = of(b)
          return eid == null || seen.has(String(eid)) ? [] : [String(eid)]
        }),
      ),
    ]
  }
  held.push(
    ...await fetch(r, missing((b) => comp(b, CALL)?.source)),
    ...await fetch(
      r,
      missing((b) => comp(b, RESULT)?.call ?? comp(b, PROGRESS)?.call),
    ),
    ...await fetch(r, missing((b) => comp(b, OUTPUT)?.source)),
  )
  let seen = new Set<Eid>()
  return ordered([...rows, ...held].filter((b) => {
    if (seen.has(b.entity.eid)) return false
    seen.add(b.entity.eid)
    return true
  }))
}

// Re-read every membership/kind fact, including legacy rows and mutable fork
// ancestors. Only content presence comes from the immutable archetype; no prose.
let withContent = async (
  g: Graph,
  entries: Bundle[],
): Promise<Bundle[] | undefined> => {
  let shapes = [...new Set(entries.map((b) => b.entity.archetype))]
  if (shapes.includes(undefined)) return undefined
  let types = await g.get(shapes as Eid[], ['archetype'])
  let byId = new Map(
    types.map((b) => [b.entity.eid, comp(b, 'archetype')?.tables]),
  )
  for (let b of entries) {
    let tables = byId.get(b.entity.archetype!)
    if (typeof tables != 'string') return undefined
    if ((JSON.parse(tables) as string[]).includes(CONTENT)) b.content = {}
  }
  return entries
}

/**
 * The entries of a transcript a status or a model turn reads, in order: the
 * newest ones down to where they stop mattering, and the older ones they name.
 */
export let reach = async (
  g: Graph,
  session: Eid,
  o: Reach = {},
): Promise<Bundle[]> => {
  // Without prose, a line is an input by the `content` its archetype holds.
  // A graph that keeps no archetypes, or a row without one, is read whole.
  if (!o.bodies && !g.vocab.comp('archetype')) o = { ...o, bodies: true }
  let entries = await read(g, session, o)
  if (o.bodies) return entries
  return await withContent(g, entries) ??
    await reach(g, session, { ...o, bodies: true })
}
