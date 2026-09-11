import { toolTiming } from '@yaks/session'
// The three session verbs a coordinator drives from a shell: `task sessions`
// (what is running and what just ran), `task tail <S>` (a transcript as it
// grows), and `task session wait <S>` (block until a session is over, print its
// brief, exit by its outcome). `wait` is the coordinator's wake path: run as a
// harness-tracked background command, its exit IS the notification (T-35019),
// and `task spawn --wait` blocks on the same `waitFor` right after minting.
//
// Two shapes of session exist side by side and every verb reads both. A LEGACY
// session is the comp set the CLI providers wear: server-stamped `session`
// status columns and an entry log fed from the jsonl tail. A NATIVE session
// (@yaks/session) is `session{id}` and nothing else: it has no status columns
// at all, its status is derived from its newest entry (`statusOf`), and its
// entries print through the package's own renderers. Every read goes through client.ts
// `query`, so the local arm answers when this process stands beside the db file
// and the wire answers otherwise. Nothing here writes.

import { jsonOf, needed, query, type Row } from './client.ts'
import { duration, type Got } from './verb.ts'
import {
  type EntryRow,
  graphLog,
  pageEntries,
  sessionStateOf,
} from './entry_log.ts'
import { renderEntry } from './log_text.ts'
import { idOf } from './types.ts'
import { safe } from './terminal.ts'
import {
  sessionDoc,
  statusOf,
  type TranscriptStatus,
  views,
} from '@yaks/session'
import { modelDoc } from '@yaks/model'
import type { Bundle } from '@yaks/render'
import { render } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { EXISTS, matchQuery, parseQuery, pred, TEXT } from './query.ts'

/** What a session is doing, in one word for both shapes. `idle` is a legacy
 * session with no live process and no recorded end. */
export type Status = TranscriptStatus | 'idle'

let LIVE = new Set(['starting', 'running', 'stopping'])
let FAILED = new Set(['failed', 'lost'])
let ENDED = new Set(['done', 'exited', 'completed', 'cancelled'])

/** A native session is identity only — `session{id}` and no legacy column
 * (the CLI providers' rows carry `agent_type`, `actor`, `turn`, a stamped
 * `status`, …); everything else is the legacy shape. */
export let native = (r: Row) =>
  r.comps.session != null &&
  Object.keys(r.comps.session).every((k) => k == 'id')

let seq = (r: Row) => Number(r.comps.entry?.seq ?? 0)
let bySeq = (rows: Row[]) => rows.toSorted((a, b) => seq(a) - seq(b))
let asLog = (entries: Row[]): EntryRow[] =>
  entries.flatMap((r) => {
    let n = seq(r)
    return n
      ? [{ eid: r.eid, seq: n, comps: r.comps as EntryRow['comps'] }]
      : []
  })

/** The `exit` entry that ends a legacy log, when it is the newest entry: the
 * explicit end a process's launcher (or a probe) records. A tool RESULT wears
 * `exit` too — one shell command's code, not the run's — so the run is over
 * only when the newest entry is an exit that answers no call (T-35230: every
 * `$ …` a codex run finished read as the run finishing). */
let exitEntry = (entries: Row[]) => {
  let last = bySeq(entries).at(-1)
  return last?.comps.exit && !last.comps.result ? last : undefined
}

/** The legacy reading, most authoritative first: the server-stamped end on the
 * session (status, finished_at, exit_code), then the log itself — an `exit`
 * entry, or the standing the shared log reader derives (a call in flight is
 * busy; a final answer, an error or a cancel is terminal) — then the live
 * status column. A non-zero exit is a failure whatever the column says. */
export let legacyStatus = (
  comps: Row['comps'],
  entries: Row[] = [],
): Status => {
  let s = comps.session ?? {}
  let st = String(s.status ?? '')
  if (Number(s.exit_code ?? 0) != 0) return 'failed'
  if (FAILED.has(st)) return 'failed'
  if (ENDED.has(st) || s.finished_at) return 'settled'
  let exit = exitEntry(entries)
  if (exit) return Number(exit.comps.exit.code ?? 0) ? 'failed' : 'settled'
  let state = entries.length ? sessionStateOf(asLog(entries)) : undefined
  if (state?.standing == 'busy') return 'running'
  if (state?.standing == 'terminal') {
    return state.end == 'completed' ? 'settled' : 'failed'
  }
  if (LIVE.has(st)) return 'running'
  return 'idle'
}

/** A row as the bundle the package renderers and `statusOf` read. */
export let bundle = (r: Row): Bundle =>
  ({ entity: { eid: r.eid, num: r.num }, ...r.comps }) as Bundle

/** The native reading: the newest entry decides (`statusOf`). */
export let nativeStatus = (entries: Row[]): Status =>
  statusOf(entries.map(bundle))

/** One status for either shape. Native needs the entries; legacy reads them
 * when given and falls back to the session's columns. */
export let statusFor = (r: Row, entries: Row[] = []): Status =>
  native(r) ? nativeStatus(entries) : legacyStatus(r.comps, entries)

/** Whether a session is over: nothing more will happen without new input. */
export let over = (s: Status) =>
  s == 'settled' || s == 'stopped' || s == 'failed'

/** The process exit code `wait` ends with: the legacy exit code when it says
 * something (the session's column, else its `exit` entry), else 1 for a
 * failure and 0 for any quiet end. */
export let exitCode = (r: Row, s: Status, entries: Row[] = []): number => {
  let code = Number(
    r.comps.session?.exit_code ?? exitEntry(entries)?.comps.exit.code ?? 0,
  )
  return code || (s == 'failed' ? 1 : 0)
}

/** The words a session leaves behind: its brief, else a legacy final text. */
export let briefOf = (r: Row, entries: Row[] = []): string => {
  let text = String(r.comps.brief?.text ?? r.comps.session?.final_text ?? '')
    .trim()
  let timing = toolTiming(entries)
  return timing && !text.includes(timing)
    ? [text, timing].filter(Boolean).join('\n\n')
    : text
}

let first = (s: unknown) => String(s ?? '').split('\n')[0].trim()

let ago = (at: unknown, now = Date.now()) => {
  let t = at ? Date.parse(String(at)) : NaN
  if (!Number.isFinite(t)) return ''
  let m = Math.round((now - t) / 60_000)
  return m < 60
    ? `${m}m`
    : m < 1440
    ? `${Math.round(m / 60)}h`
    : `${Math.round(m / 1440)}d`
}

/** One line per session: id, status, who runs it, how long since it moved,
 * and what it is about (its brief's first line, else its requested task). */
export let sessionLine = (r: Row, s: Status, now = Date.now()) => {
  let sess = r.comps.session ?? {}
  let by = [sess.provider, sess.model].filter(Boolean).join('/')
  let what = first(r.comps.brief?.text) || String(sess.requested_task ?? '')
  return [
    idOf({ eid: r.eid, kind: 'session', num: r.num }).padEnd(8),
    s.padEnd(8),
    by.padEnd(22),
    ago(r.comps.updated?.at ?? sess.finished_at ?? sess.started_at, now)
      .padStart(4),
    what,
  ].join(' ').trimEnd()
}

/** The entries of a session, transcript order. A fork's inherited prefix is
 * the parent's entries up to the anchor, the way @yaks/session reads it. */
export let entriesOf = async (r: Row): Promise<Row[]> => {
  let own = await query([`.entry.session=${r.eid}`], { limit: 1_000_000 })
  let from = r.comps.fork?.from
  if (!from) return bySeq(own)
  let [anchor] = await query([`id=${from}`])
  let parentEid = anchor?.comps.entry?.session
  if (!parentEid) return bySeq(own)
  let [parent] = await query([`id=${parentEid}`])
  let inherited = parent ? await entriesOf(parent) : []
  return [...inherited.filter((b) => seq(b) <= seq(anchor)), ...bySeq(own)]
}

// The two documents a native transcript is read with, loaded once: the
// renderer consults them on every line.
let loaded: ReturnType<typeof loadVocab> | undefined
let vocab = () => loaded ??= loadVocab([sessionDoc, modelDoc])

/** Native entries as lines, through the package's `Line` renderer. */
export let nativeLines = (entries: Row[], v = vocab()) =>
  entries.map((e) => render(views, bundle(e), 'Line', v, {}, 'plain').trim())

/** Legacy entries as lines, through the shared log formatter; `after` keeps
 * only what a follower has not printed yet. */
export let legacyLines = (
  entries: Row[],
  p: { after?: number; tail?: number } = {},
) => {
  let log = graphLog(asLog(entries))
  return pageEntries(log.entries, p).flatMap((e) => {
    let line = renderEntry(e, 200)
    return line == null ? [] : [line]
  })
}

export let following = (got: Got) =>
  got.flags.has('--follow') || got.opts['--follow'] != null

/** Entry-local query predicates, using the ordinary typed query parser and
 * matcher. The follow door also accepts the package grammar's `.comp`
 * presence spelling. No comma presence union exists in the Tasks grammar:
 * commas list VALUES, so the default is three ordinary presence queries ORed.
 * Refuse graph-wide clauses rather than silently ignoring them locally. */
export let followFilter = (raw?: string, spawn = false) => {
  let filters = raw == null
    ? spawn ? ['.notify!', '.error!', '.stop!'] : ['.entry!']
    : [raw]
  let groups = filters.map((filter) => {
    let ps = parseQuery(filter, { notify: {} }).map((p) => {
      if (p.op == TEXT && /^\.[A-Za-z_]+$/.test(p.value)) {
        return pred(`${p.value}!`, { notify: {} })!
      }
      return p
    })
    if (
      ps.some((p) =>
        (!p.comp && !p.prop) || p.op == TEXT || p.at || p.rev || p.refs ||
        !['', EXISTS, '~', '!', '<', '<=', '>', '>='].includes(p.op)
      )
    ) {
      throw new Error(
        '--follow needs entry-local predicates, e.g. .error or .content.body~=landed',
      )
    }
    return ps
  })
  return (r: Row) =>
    groups.some((ps) =>
      matchQuery({ ...r.comps, entity: { eid: r.eid, num: r.num } }, ps)
    )
}

/** Exactly one physical line for EVERY selected entry, even one the legacy
 * transcript renderer normally hides. JSON is not terminal-sanitized: its
 * own escaping preserves every byte of content without emitting newlines. */
export let entryLines = (r: Row, all: Row[], selected: Row[], json = false) => {
  if (json) {
    return selected.map((e) =>
      JSON.stringify(jsonOf(e, {
        ...e.comps,
        entity: { ...e.comps.entity, eid: e.eid, num: e.num },
      }))
    )
  }
  let rendered = native(r)
    ? new Map(nativeLines(selected).map((line, i) => [selected[i].eid, line]))
    : new Map(
      graphLog(asLog(all)).entries.map((e) => [e.eid, renderEntry(e, 200)]),
    )
  return selected.map((e) => {
    let line = rendered.get(e.eid)
    if (!line) {
      let tags = Object.keys(e.comps).filter((k) =>
        k != 'entity' && k != 'entry'
      )
      line = `${seq(e)} ${tags.join(' ')} ${e.comps.content?.body ?? ''}`
    }
    return safe(line).replace(/\s+/g, ' ').trim()
  })
}

/** A follower remembers entry identities, not a filtered sequence watermark:
 * fork prefixes may come from different partitions with overlapping seqs. */
export let entryFollower = (got: Got, spawn = false) => {
  let matches = followFilter(got.opts['--follow'], spawn)
  let seen = new Set<string>()
  return (r: Row, all: Row[], candidates = all) => {
    let fresh = candidates.filter((e) => !seen.has(e.eid) && matches(e))
    for (let e of all) seen.add(e.eid)
    return entryLines(r, all, fresh, got.flags.has('--json'))
  }
}

// console.log writes synchronously to stdout on Deno, one call per entry.
// In particular do not join an entire poll's output into a single write.
let emitEntries = (lines: string[]) => {
  for (let line of lines) console.log(line)
}

/** Poll `read` until `done` says so, or the deadline passes. `sleep` is a seam
 * so a test drives the loop without a clock. */
export let poll = async <T>(
  read: () => Promise<T>,
  done: (t: T) => boolean,
  opts: {
    interval?: number
    timeout?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<T> => {
  let interval = opts.interval ?? 1000
  let sleep = opts.sleep ?? ((ms) => new Promise((go) => setTimeout(go, ms)))
  let deadline = opts.timeout ? Date.now() + opts.timeout : Infinity
  for (;;) {
    let t = await read()
    if (done(t)) return t
    if (Date.now() >= deadline) throw new Error('timed out')
    await sleep(interval)
  }
}

let out = (line: string) => console.log(safe(line))
let ms = (got: Got, name: string, dflt: number) => {
  let n = Number(got.opts[name])
  return Number.isFinite(n) && got.opts[name] != null ? n : dflt
}

let sessionAt = async (id: string) => {
  let r = await needed(id, '', 'session')
  if (!r.comps.session) {
    throw new Error(`not a session: ${idOf({ ...r, kind: 'session' })}`)
  }
  return r
}

/** Whether the server has stamped a legacy session's end, so the log need not
 * be read to know it is over. */
let stampedEnd = (r: Row) => {
  let s = r.comps.session ?? {}
  return Boolean(
    s.finished_at || Number(s.exit_code ?? 0) ||
      ENDED.has(String(s.status)) || FAILED.has(String(s.status)),
  )
}

/** The tail of a legacy log, enough to read its standing without paging the
 * whole partition: the last ~60 entries when the server says how long it is.
 * A window can only under-report a call in flight, never invent one. */
let tailEntries = (r: Row) => {
  let latest = Number(r.comps.session?.latest_seq ?? 0)
  return query(
    [`.entry.session=${r.eid}`],
    latest > 60 ? { after: latest - 60, limit: 200 } : { limit: 1_000_000 },
  )
}

/** `task sessions [-n N] [--live]`: the newest N sessions, one line each, the
 * status read the way `wait` reads it. */
export let sessions = async (got: Got) => {
  let n = ms(got, '-n', 20)
  let rows = await query([
    '.kind=session',
    '.order=-updated',
    `.limit=${n}`,
  ])
  let lines = await Promise.all(rows.map(async (r) => {
    let entries = native(r)
      ? await entriesOf(r)
      : stampedEnd(r)
      ? []
      : await tailEntries(r)
    return { r, s: statusFor(r, entries) }
  }))
  let shown = got.flags.has('--live')
    ? lines.filter(({ s }) => s == 'running' || s == 'pending')
    : lines
  if (got.flags.has('--json')) {
    return out(JSON.stringify(
      shown.map(({ r, s }) => ({
        id: idOf({ eid: r.eid, kind: 'session', num: r.num }),
        status: s,
        native: native(r),
      })),
    ))
  }
  for (let { r, s } of shown) out(sessionLine(r, s))
}

/** `task tail <S> [-n N] [--follow] [--interval MS]`: the transcript's last N
 * entries, then each new one as it lands. Follow ends when the session is
 * over. */
export let tail = async (got: Got) => {
  let id = got.args.id
  if (!id) throw new Error('task tail <S> [-n N] [--follow] [--interval MS]')
  let show = entryFollower(got)
  let r = await sessionAt(id)
  let n = ms(got, '-n', 20)
  let follow = following(got)
  let interval = ms(got, '--interval', 1000)
  let entries = await entriesOf(r)
  emitEntries(show(r, entries, entries.slice(-n)))
  if (!follow && !got.flags.has('--json')) {
    out(
      `${idOf({ eid: r.eid, kind: 'session', num: r.num })}: ${
        statusFor(r, entries)
      }`,
    )
  }
  if (!follow) return
  if (over(statusFor(r, entries))) {
    let code = exitCode(r, statusFor(r, entries), entries)
    if (code) Deno.exit(code)
    return
  }
  for (;;) {
    await new Promise((go) => setTimeout(go, interval))
    let [again] = await query([`id=${r.eid}`])
    if (!again) return
    let all = await entriesOf(again)
    emitEntries(show(again, all))
    if (over(statusFor(again, all))) {
      let code = exitCode(again, statusFor(again, all), all)
      if (code) Deno.exit(code)
      return
    }
  }
}

/** A missing timeout is unbounded; a bare number still means seconds. */
export let timeoutMs = (raw?: string): number => {
  if (raw == null) return 0
  let unit = raw.slice(-1)
  let scale = unit == 'h' ? 3600 : unit == 'm' ? 60 : 1
  let n = Number(raw.replace(/[smh]$/, '')) * scale * 1000
  if (!duration.test!.test(raw) || !Number.isSafeInteger(n)) {
    throw new Error('--timeout needs a positive duration (seconds, 45m, or 2h)')
  }
  return n
}

/** `task session wait <S> [--timeout DURATION] [--interval MS] [--json]`: block until
 * the session is over, print its brief, exit 0 on a quiet end and non-zero on
 * a failure (the legacy exit code when there is one). */
export let wait = (got: Got) => {
  let id = got.args.id
  if (!id) {
    throw new Error(
      'task session wait <S> [--timeout DURATION] [--interval MS]',
    )
  }
  return waitFor(id, got)
}

/** The wait itself, named apart from its verb so `task spawn --wait` blocks on
 * the session it just minted through this same path — same output, same exit
 * code. `got` carries only the options (`--timeout`, `--interval`, `--json`);
 * the session is the `id` argument. */
export let waitFor = async (id: string, got: Got) => {
  let timeout = timeoutMs(got.opts['--timeout'])
  let show = following(got) ? entryFollower(got, true) : undefined
  let r = await sessionAt(id)
  let interval = ms(got, '--interval', 1000)
  let read = async () => {
    let [again] = await query([`id=${r.eid}`])
    if (!again) throw new Error(`${id}: gone`)
    let entries = await entriesOf(again)
    if (show) emitEntries(show(again, entries))
    return { r: again, s: statusFor(again, entries), entries }
  }
  let end = await poll(read, ({ s }) => over(s), { interval, timeout })
  let code = exitCode(end.r, end.s, end.entries)
  let name = idOf({ eid: end.r.eid, kind: 'session', num: end.r.num })
  if (show) {
    // Only entry lines in follow mode, including at the terminal poll.
  } else if (got.flags.has('--json')) {
    out(
      JSON.stringify({
        id: name,
        status: end.s,
        code,
        brief: briefOf(end.r, end.entries),
      }),
    )
  } else {
    out(`${name}: ${end.s}`)
    let brief = briefOf(end.r, end.entries)
    if (brief) out(brief)
  }
  if (code) Deno.exit(code)
}
