// What a step reads of a transcript. A status, a runner step and a tool
// snapshot each decide from the newest part of a transcript and the few older
// entries that part names; reading all of it made a step cost more with every
// line the transcript had ever held (T-128248).
//
// `reach` reads newest first, a page at a time, and stops at the oldest seq
// any of those decisions still looks at: the newest ask and the boundary it
// was sent from, the turns a retry counts back through, the last stop, and for
// a model turn the summary a checkpoint left and everything after the line it
// replaced, or the lines a finite `sending.window` sends. Beyond that edge it
// adds only the entries those name (a call a result answers, the ask a line
// came from, the newest `using` and `sending`, the prompts a checkpoint
// retains), each by one query. A step running one call reads what its tool
// reads of the turn (those prompts, `using` and `sending`) and stops where a
// status does: it sends no window, so it never reads one. What it returns
// answers every function of ./state.ts and ./compact.ts as the whole
// transcript would; ./reach_test.ts holds the two together.
//
// Those lookups beyond the edge are remembered, so a step costs the lines
// appended since the last, not the transcript's length. A line is appended at
// the next seq (./append.ts), and what each lookup selects changes only by a
// line appended (a call, the result answering it, a stop, a checkpoint) or by
// the lines it found: the next reading asks only those and the lines appended
// since, each by name. A lookup on a transcript whose newest lines were
// deleted, which may append at those seqs again, or that more lines landed on
// than a lookup asks for by name, reads it whole. A mark set on an older line
// (`provisional` on an ask) is read each time.
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
  statusOf,
  type TranscriptStatus,
  usingBefore,
} from './state.ts'
import { type Segment, transcriptSegments, within } from './window.ts'

const SENDING = 'sending'
const PROGRESS = 'tool_progress'
const FIRST = 64
// The most lines appended since a lookup that it asks for by name; past them
// (an import, a run another process wrote) it reads the transcript whole.
const SINCE = 256

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

export type Reach = {
  /** read prose too: the lines a model is sent, their bodies in hand */
  bodies?: boolean
  /** a model turn: its context (checkpoint, prompts, window) is reached too */
  turn?: boolean
  /** a tool call: what a tool reads of the turn it came from (the prompts,
   * the model selection and `sending` in force), but not the window that
   * turn sent */
  call?: boolean
  /** the components to read of each entry; every one but prose by default */
  comps?: string[]
}

// One reading: the chain of segments and what of each entry it brings.
type Read = {
  g: Graph
  segs: Segment[]
  names?: string[]
  fields: string
  found: Map<string, Promise<Bundle | undefined>>
  shapes: Map<string, string[]>
  /** the lines of a segment it looked at, by the query naming them */
  lines: Map<string, Promise<Line[]>>
}

type Line = { eid: Eid; seq: number }

// What a lookup found in a segment, and the line it was true through.
type Known = Line & { found: Eid[] }

const KEPT = 1024
let memories = new WeakMap<Graph, Map<string, Known>>()

let chain = async (g: Graph, session: Eid, o: Reach): Promise<Read> => {
  let names = o.bodies
    ? o.comps ? [...new Set([...o.comps, CONTENT])] : undefined
    // A runner needs private execution pins too; `comps` is only the
    // wire-writable component list and omits inference recovery authority.
    : o.comps ?? g.vocab.all.filter((n) => n != CONTENT && n != 'session')
  return {
    g,
    segs: await transcriptSegments(g, session),
    names,
    fields: names ? names.map((n) => '?' + n).join('&') : '*',
    found: new Map(),
    shapes: new Map(),
    lines: new Map(),
  }
}

// Select identities separately, then gather the components actually present.
// Projecting every optional component forces a scalar read for each declared
// component, even though an entry carries only a handful of them. Several
// queries' entities are gathered at once; a query asked of named entities
// alone carries them beside it.
type Ask = string | { q: string; eids: Eid[] }
let selected = async (r: Read, ...asks: Ask[]): Promise<Bundle[]> => {
  let fields = r.g.vocab.comp('archetype')
    ? '&.fields=entity.eid,entity.archetype'
    : '&.fields=entity.eid'
  let owners = []
  for (let a of asks) {
    owners.push(
      ...typeof a == 'string'
        ? await r.g.rows(a + fields)
        : await r.g.rows(a.q + fields, { eids: a.eids }),
    )
  }
  let ids = owners.map((b) => String(b['entity.eid']))
  if (!ids.length) return []
  let names = r.names
  if (names && r.g.vocab.comp('archetype')) {
    let keys = [...new Set(owners.map((b) => b['entity.archetype']))]
    if (!keys.includes(undefined)) {
      let missing = keys.filter((key) => !r.shapes.has(String(key)))
      let shapes = missing.length
        ? await r.g.get(missing as Eid[], ['archetype'])
        : []
      for (let b of shapes) {
        let text = comp(b, 'archetype')?.tables
        if (typeof text == 'string') {
          r.shapes.set(b.entity.eid, JSON.parse(text))
        }
      }
      if (keys.every((key) => r.shapes.has(String(key)))) {
        let present = new Set(keys.flatMap((key) => r.shapes.get(String(key))!))
        names = names.filter((n) => present.has(n))
      }
    }
  }
  let rows = new Map((await r.g.get(ids, names)).map((b) => [b.entity.eid, b]))
  return ids.flatMap((id) => rows.get(id) ?? [])
}

// Older rows of the whole chain, `n` at a time, newest first.
let pages = (r: Read) => {
  let { segs } = r
  let i = segs.length - 1, after = ''
  return {
    get done() {
      return i < 0
    },
    next: async (n: number): Promise<Bundle[]> => {
      let got: Bundle[] = []
      while (i >= 0 && got.length < n) {
        let want = n - got.length
        let rows = await selected(
          r,
          `${within(segs[i])}&.order=-entry.seq&.limit=${want}${after}`,
        )
        got.push(...rows)
        if (rows.length < want) {
          i--
          after = ''
        } else after = `&.after=${rows.at(-1)!.entity.eid}`
      }
      return got
    },
    // Every row from `at` up that is still unread, a query for each segment
    // it spans: a segment is read whole when the one before it still holds
    // seqs at or above `at`, since the seqs of a segment all pass those before.
    until: async (at: number): Promise<Bundle[]> => {
      let got: Bundle[] = []
      while (i >= 0) {
        let rows = await selected(
          r,
          `${within(segs[i])}&.entry.seq>=${at}&.order=-entry.seq${after}`,
        )
        got.push(...rows)
        if (rows.length) after = `&.after=${rows.at(-1)!.entity.eid}`
        if (i == 0 || segs[i - 1].through < at) break
        i--
        after = ''
      }
      return got
    },
  }
}

// A segment's lines from `seq` up, newest first, as many as SINCE lines
// appended after it, or its newest line alone: their identities, read once a
// reading.
let tail = (r: Read, s: Segment, seq?: number): Promise<Line[]> => {
  let q = within(s) +
    (seq == null ? '&.limit=1' : `&.entry.seq>=${seq}&.limit=${SINCE + 1}`)
  let held = r.lines.get(q)
  if (held) return held
  let read =
    (async () =>
      (await r.g.rows(q + '&.order=-entry.seq&.fields=entity.eid,entry.seq'))
        .map((row) => ({
          eid: String(row['entity.eid']),
          seq: Number(row['entry.seq']),
        })))()
  r.lines.set(q, read)
  return read
}

// What a lookup in a segment found before, while the line it was true through
// is still that line, and the segment's newest line now. `ask` is what the
// lookup asks again: the lines it found and those appended since.
let recall = async (
  r: Read,
  s: Segment,
  qualifier: string,
): Promise<{ known?: Known; edge?: Line; ask: Eid[] }> => {
  let known = memories.get(r.g)?.get(within(s) + qualifier)
  let lines = await tail(r, s, known?.seq)
  let at = lines.at(-1)
  if (!known || at?.seq != known.seq || at?.eid != known.eid) {
    return { edge: lines[0], ask: [] }
  }
  return {
    known,
    edge: lines[0],
    ask: [...lines.slice(0, -1).map((l) => l.eid), ...known.found],
  }
}

// What a lookup found, true through `edge`, the newest line before it looked.
let keep = (
  r: Read,
  s: Segment,
  qualifier: string,
  edge: Line | undefined,
  found: Bundle[],
) => {
  let kept = memories.get(r.g) ?? new Map<string, Known>()
  memories.set(r.g, kept)
  let key = within(s) + qualifier
  kept.delete(key)
  if (!edge) return
  kept.set(key, { ...edge, found: found.map((b) => b.entity.eid) })
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!)
}

// The newest entry a qualifier selects, and every one of them.
let newest = (r: Read, qualifier: string): Promise<Bundle | undefined> => {
  let seen = r.found.get(qualifier)
  if (seen) return seen
  let found = (async () => {
    for (let s of r.segs.toReversed()) {
      let { known, edge, ask } = await recall(r, s, qualifier)
      let q = `${within(s)}${qualifier}&.order=-entry.seq&.limit=1`
      let page = async (eids?: Eid[]) =>
        (await selected(r, eids ? { q, eids } : q))[0]
      let row = !known ? await page() : ask.length ? await page(ask) : undefined
      // What it found before is gone or no longer one: read it all again.
      if (known?.found.length && !row) row = await page()
      keep(r, s, qualifier, edge, row ? [row] : [])
      if (row) return row
    }
  })()
  r.found.set(qualifier, found)
  return found
}
let every = async (r: Read, qualifier: string): Promise<Bundle[]> =>
  (await Promise.all(r.segs.map(async (s) => {
    let { known, edge, ask } = await recall(r, s, qualifier)
    let q = within(s) + qualifier
    let found = !known
      ? await selected(r, q)
      : ask.length
      ? await selected(r, { q, eids: ask })
      : []
    keep(r, s, qualifier, edge, found)
    return found
  }))).flat()

// The named entries that are lines of this transcript: an entry another
// transcript holds, or one a fork left behind, is not among its entries.
let fetch = async (r: Read, eids: Iterable<Eid>): Promise<Bundle[]> => {
  let ids = [...new Set(eids)]
  if (!ids.length) return []
  let found = await r.g.get(
    ids,
    r.names?.includes(ENTRY) ? r.names : [ENTRY, ...r.names ?? []],
  )
  return found.filter((b) => {
    let at = comp(b, ENTRY)
    return r.segs.some((s) =>
      s.session == at?.session && Number(at.seq) <= s.through
    )
  })
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

// What `statusOf` reads of an entry.
const STATUS = [
  ENTRY,
  ASK,
  CALL,
  RESULT,
  PROGRESS,
  'tool_async',
  OUTPUT,
  USING,
  SENDING,
  'attempt',
  'execution',
  'interrupted',
  'failed',
  'provisional',
  'notice',
  'stop',
  'exception',
  'refusal',
]

/** What a transcript is doing, read off the entries a status looks at. The
 * adapter's derived `session.status` is this rule too, but it computes it over
 * every entry each time it is asked, so the cost of asking grows with the
 * transcript; this reads the newest part. A stop the caller observed from
 * outside (`session.ended`) is the only thing besides entries that ends one. */
export let entryStatus = async (
  g: Graph,
  session: Eid,
): Promise<TranscriptStatus> => {
  let [row] = await g.rows(`.entity.eid=${session}&.fields=session.ended`)
  return statusOf(
    await reach(g, session, {
      comps: STATUS.filter((name) => g.vocab.comp(name)),
    }),
    row?.['session.ended'] === true,
  )
}

/** The model selection in force on a transcript, as the whole of it would say. */
export let usingOf = async (
  g: Graph,
  session: Eid,
): Promise<Comp | undefined> =>
  usingBefore(
    await aspect(
      await chain(g, session, { comps: [ENTRY, USING, ASK] }),
      USING,
    ),
  )

/** The newest entry of a transcript, prose and all. */
export let newestOf = async (
  g: Graph,
  session: Eid,
): Promise<Bundle | undefined> =>
  newest(await chain(g, session, { bodies: true }), '')

/** Whether a transcript holds an ask. */
export let hasAsk = async (g: Graph, session: Eid): Promise<boolean> =>
  !!await newest(await chain(g, session, { comps: [ENTRY] }), `&.${ASK}`)

// What a reading holds besides its newest rows, found by one lookup for all:
// the open calls (which no result answers), the prompts for a model turn or a
// tool call, and the checkpoints for a model turn; and for a model turn the
// asks the runner owes a retry, by a query of their own, since that mark is
// set on an ask already written. The mark is named first: a query is driven
// by the first component it names, and the few marked entities are read where
// every ask of the graph, or every line of the transcript, would be.
let named = async (r: Read, o: Reach): Promise<Bundle[]> => {
  let has = (name: string) => r.g.vocab.comp(name)
  let turn = !!o.turn
  let parts = [
    ...turn && has('checkpoint') ? ['.checkpoint'] : [],
    ...(turn || o.call) && has('prompt') ? ['.prompt'] : [],
    ...has(CALL) && has(RESULT) ? [`.${CALL} !${RESULT}s`] : [],
  ]
  let retry = `&.provisional&.${ASK}`
  return [
    ...parts.length ? await every(r, `&(${parts.join('|')})`) : [],
    ...turn && has('provisional')
      ? await selected(r, ...r.segs.map((s) => within(s) + retry))
      : [],
  ]
}

/** The calls of a transcript no result answers. */
export let openOf = async (g: Graph, session: Eid): Promise<Bundle[]> =>
  (await named(await chain(g, session, { comps: [ENTRY, CALL] }), {}))
    .filter((b) => b.call)

// What a decision still reads, found as the rows come: the oldest seq the rows
// must reach, undefined while they cannot say.
type Needs = {
  rows: Bundle[]
  stop: () => Promise<number | undefined>
  seqAt: (eid: Eid) => Promise<number | undefined>
  mark?: number
  noAsk?: boolean
  window: (rows: Bundle[]) => Promise<unknown>
}

let floor = async (n: Needs, turn: boolean): Promise<number | undefined> => {
  let { rows } = n
  let all = rows.filter((b) => !b.notice || stoppedNotice(b))
  let ask = all.findLast((b) => kindOf(b) == 'ask')
  let turns = all.filter((b) => b.ask || kindOf(b) == 'input')
  if (!ask && !n.noAsk) return undefined
  // A completed request ends the retry streak. With no request at all there
  // is no retry history to find among older notices and stops.
  if (ask && turns.length < RETRIES && attemptState(ask) != 'completed') {
    return undefined
  }
  let seqs = ask ? [seqOf(ask)] : []
  if (turns.length >= RETRIES) seqs.push(seqOf(turns.at(-RETRIES)!))
  // The newest input or stop says whether the transcript is stopped. An
  // imported stop is a notice among the lines, found only by reading them.
  let control = all.findLast((b) => ['input', 'stop'].includes(kindOf(b)!))
  if (rows.some((b) => b.lines)) {
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
  if (ask) await sent(ask)
  if (turn) {
    let done = rows.findLast((b) => b.ask && attemptState(b) == 'completed')
    if (!done && !n.noAsk) return undefined
    if (done) {
      seqs.push(seqOf(done))
      await sent(done)
    }
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

let read = async (g: Graph, session: Eid, o: Reach): Promise<{
  entries: Bundle[]
  shapes: Map<string, string[]>
}> => {
  let r = await chain(g, session, o)
  let held = await named(r, o)
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
    let next = await page.next(size)
    if (!o.bodies) next = await withContent(g, next, r.shapes) ?? next
    rows.unshift(...next.reverse())
    if (n.noAsk == null && !rows.some((b) => kindOf(b) == 'ask')) {
      n.noAsk = !await newest(
        { ...r, names: [ENTRY], fields: '?entry' },
        `&.${ASK}`,
      )
    }
    let at = await floor(n, !!o.turn)
    if (page.done || at != null && seqOf(rows[0]) <= at) break
    // What the rows settle is a seq: read down to it at once, not by halves.
    if (at != null && at > -Infinity) {
      let older = await page.until(at)
      if (!o.bodies) older = await withContent(g, older, r.shapes) ?? older
      rows.unshift(...older.reverse())
      let again = await floor(n, !!o.turn)
      if (page.done || again != null && seqOf(rows[0]) <= again) break
    }
    size *= 2
  }
  // Older entries the rows name: what a model selection is in force, the call
  // a result answers, the ask a reply or call came from, and what the open
  // calls have reported.
  if (o.turn || o.call) {
    held.push(
      ...await aspect(r, USING, rows),
      ...await aspect(r, SENDING, rows),
    )
  }
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
  let entries = ordered([...rows, ...held].filter((b) => {
    if (seen.has(b.entity.eid)) return false
    seen.add(b.entity.eid)
    return true
  }))
  return { entries, shapes: r.shapes }
}

// Re-read every membership/kind fact, including legacy rows and mutable fork
// ancestors. Only content presence comes from the immutable archetype; no prose.
let withContent = async (
  g: Graph,
  entries: Bundle[],
  known = new Map<string, string[]>(),
): Promise<Bundle[] | undefined> => {
  let shapes = [...new Set(entries.map((b) => b.entity.archetype))]
  if (shapes.includes(undefined)) return undefined
  let missing = shapes.filter((id) => !known.has(id!))
  let types = missing.length ? await g.get(missing as Eid[], ['archetype']) : []
  for (let b of types) {
    let text = comp(b, 'archetype')?.tables
    if (typeof text == 'string') known.set(b.entity.eid, JSON.parse(text))
  }
  for (let b of entries) {
    let tables = known.get(b.entity.archetype!)
    if (!tables) return undefined
    if (tables.includes(CONTENT)) b.content = {}
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
  let { entries, shapes } = await read(g, session, o)
  if (o.bodies) return entries
  return await withContent(g, entries, shapes) ??
    await reach(g, session, { ...o, bodies: true })
}
