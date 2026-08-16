import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import {
  awake,
  type Ent,
  friendly,
  idOf,
  kilo,
  type LogRow,
} from '../../types.ts'
import {
  base,
  commentsOn,
  ent,
  findEid,
  mutate,
  observation,
  repoUrl,
  uuid,
} from '../../live.ts'
import { graphLog } from '../../entry_log.ts'
import { type ObservationState } from '../../observations.ts'
import { slot, tileLink, type TileProps, tileTitle } from '../Tile.tsx'
import { ago, block, pretty, Stamp } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Composer, Note } from '../Comments.tsx'
import { Id } from './Inline.tsx'
import { Entity, resolve } from '../Entity.tsx'
import { Markdown } from '../Markdown.tsx'
import { mdMentions, type Mention } from '../../md.ts'
import { UrlVal } from '../editors.tsx'
import { Ansi } from '../Ansi.tsx'
import { SessionDot, useSessionStanding } from '../session_status.tsx'
import {
  EntryBody,
  EntryLens,
  type EntryLine,
  EntrySummary,
  entryVisible,
  ToolSummary,
} from './Entry.tsx'
import { entityUrl } from '../../url.ts'

// An agent session, watched — the console (W-3676 #5): a sticky slim bar
// (task, lifecycle summary, stop — server-owned columns riding
// the snapshot like any component, so the bar re-renders itself as the
// run moves), the log with the session's comments woven in by time, then
// the pinned composer (Comments.tsx), which is the way to talk TO the
// agent.
//
// Both durable logs normalize to one renderer row: process-backed Sessions
// page their JSONL over /logs, while graph-native Sessions subscribe to their
// ordered entry partition. The browser never learns a provider dialect.

let Frame = block('div', 'Session', {
  Head: 'div',
  Summary: 'div',
  Context: 'span',
  Stop: 'button',
  Body: 'div',
  References: 'details',
  ReferencesGist: 'summary',
  ReferencesList: 'div',
  Reference: 'div',
  Facts: 'details',
  Diagnostics: 'details',
  Gist: 'summary',
  Kv: 'div',
  Key: 'span',
  Val: 'span',
  Think: 'div',
  Transient: 'div',
  Final: 'div',
  Fault: 'p',
  Log: 'div',
  Earlier: 'button',
  Line: 'div',
  Content: 'div',
  Seq: 'button',
  When: 'time',
  Err: 'pre',
  Json: 'pre',
  Unsent: 'div',
  Foot: 'div',
})
let {
  Head,
  Summary,
  Context,
  Stop,
  Body: Panel,
  References,
  ReferencesGist,
  ReferencesList,
  Reference,
  Facts,
  Diagnostics,
  Gist,
  Kv,
  Key,
  Val,
  Think,
  Transient,
  Final,
  Fault,
  Log,
  Earlier,
  Line,
  Content,
  Seq,
  When,
  Err,
  Json,
  Unsent,
  Foot,
} = Frame

type Entry = EntryLine
type Log = { entries: Entry[]; stderr?: string; context?: number }
type Mentioned =
  | { kind: 'entity'; id: string; eid?: string }
  | { kind: 'link'; href: string }

// A run of same-tag sys frames is one fact told many times (the
// thinking-token stream grows an estimate frame by frame): keep the
// LAST of the run — its text is the current count, carried forward when
// the newest frame has none — and remember how many frames it speaks
// for. Distinct texts (a hook start, a task notification) never
// squeeze: each is its own news.
let squeeze = (entries: Entry[]) => {
  let out: Entry[] = []
  for (let x of entries) {
    let p = out.at(-1)
    if (
      x.row?.kind == 'sys' && p?.row?.kind == 'sys' &&
      x.row.tag == p.row.tag &&
      (x.row.tag == 'thinking' || x.row.text == p.row.text)
    ) {
      out[out.length - 1] = {
        ...x,
        row: x.row.text ? x.row : p.row,
        n: (p.n ?? 1) + 1,
      }
    } else out.push(x)
  }
  return out
}

// ISO in the db; a local clock is what a human reads.
let when = (t?: string | null) => t ? new Date(t).toLocaleString() : null

let lineLabel = (text: string) => {
  let n = text.replace(/\n$/, '').split('\n').length
  return `${n} ${n == 1 ? 'line' : 'lines'}`
}

// Weave the heard comments into the log by time: only says wear a
// clock, so each line carries the last one seen forward, and a comment
// slots in after everything said before it. Comments the log can't
// place yet (no timestamped line reached) flush before the first one
// that can; leftovers land at the end.
let weave = (rows: Entry[], cs: Ent[]) => {
  let out: (Entry | Ent)[] = []
  let i = 0, t = ''
  for (let x of rows) {
    if (x.row?.kind == 'say' && x.row.at) t = x.row.at
    while (i < cs.length && t && String(cs[i].created?.at ?? '') <= t) {
      out.push(cs[i++])
    }
    out.push(x)
  }
  return [...out, ...cs.slice(i)]
}

type MentionLine = Partial<Entry>
let mentionLine = (x: MentionLine | Ent): x is MentionLine => 'row' in x

let mentionText = (x: MentionLine | Ent) => {
  if (mentionLine(x)) return x.row?.kind == 'say' ? [x.row.text] : []
  return [x.doc?.body ?? '']
}

// The SCAN — the expensive half: mdMentions parses every text in the thread.
// On a large log this is milliseconds, so the render path memoizes it (keyed on
// mentionSig) and never runs it per render.
export let threadMentions = (
  thread: (MentionLine | Ent)[],
  repo?: string,
): Mention[] =>
  thread.flatMap(mentionText).flatMap((text) => mdMentions(text, repo))

// Resolve entity ids to eids and dedupe — the CHEAP half over the already-parsed
// mentions, so it stays per render and an eid that loads in late still links.
// The first mention wins its place; entity spellings dedupe by the entity they
// resolve to, so a labeled link and a later bare id still make one row.
export let resolveMentions = (raw: Mention[]): Mentioned[] => {
  let out: Mentioned[] = []
  let seen = new Set<string>()
  for (let mention of raw) {
    let item: Mentioned
    if (mention.kind == 'entity') {
      let eid = findEid(mention.id)
      item = { kind: 'entity', id: mention.id, ...(eid ? { eid } : {}) }
    } else item = mention
    let key = item.kind == 'entity'
      ? `entity:${item.eid ?? item.id}`
      : `link:${item.href}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

// Parse then resolve. Non-render callers use this directly; the render path
// splits the two so it can memoize the scan (threadMentions) alone.
export let sessionMentions = (
  thread: (MentionLine | Ent)[],
  repo?: string,
): Mentioned[] => resolveMentions(threadMentions(thread, repo))

// A cheap content signature for the mention scan: everything that changes the
// parsed mentions, read as ids/seqs/stamps — no markdown parse, no walk of the
// thread text — so useMemo reruns the scan once per content change, never per
// render. Log rows are append-only (seq + count + streaming rev cover growth);
// a heard comment set is keyed by its size and newest edit (add/remove/edit/
// heard-flip all move one of the two).
export let mentionSig = (a: {
  count: number
  seq: number
  rev: number
  said: boolean
  final: string
  heard: Ent[]
  repo?: string
}): string =>
  [
    a.count,
    a.seq,
    a.rev,
    a.said ? 1 : 0,
    a.final,
    a.heard.length,
    a.heard.reduce((m, c) => {
      let t = String(c.updated?.at ?? c.created?.at ?? '')
      return t > m ? t : m
    }, ''),
    a.repo ?? '',
  ].join('|')

export let SessionReferences = ({ items }: { items: Mentioned[] }) => {
  let [open, setOpen] = useState(true)
  if (!items.length) return null
  return (
    <References
      open={open}
      onToggle={(ev: Event) =>
        setOpen((ev.currentTarget as HTMLDetailsElement).open)}
    >
      <ReferencesGist>references · {items.length}</ReferencesGist>
      <ReferencesList>
        {items.map((item) => (
          <Reference
            key={item.kind == 'entity' ? item.eid ?? item.id : item.href}
          >
            {item.kind == 'entity'
              ? item.eid
                ? <Entity eid={item.eid} view='Inline' />
                : (
                  <a href={entityUrl(item.id)} data-ref={item.id}>
                    {item.id}
                  </a>
                )
              : UrlVal(item.href)}
          </Reference>
        ))}
      </ReferencesList>
    </References>
  )
}

// The tail thinks out loud: provider progress and unresolved graph work win;
// the newest durable row remains the fallback for process-backed sessions.
export let doing = (r?: LogRow, turn?: string | null, starting = false) =>
  r?.kind == 'reason'
    ? 'thinking…'
    : r?.kind == 'sys' && r.tag == 'thinking'
    ? (r.text ? `thinking · ${r.text}` : 'thinking…')
    : r?.kind == 'sys' && r.tag == 'generation'
    ? 'waiting for model…'
    : r?.kind == 'exec' && r.exit == null && !r.status
    ? 'running command…'
    : r?.kind == 'tool' && r.ok == null
    ? `running ${r.name}…`
    : turn == 'idle' || r?.kind == 'turn' ||
        (r?.kind == 'say' && r.role == 'agent')
    ? 'waiting for request…'
    : r?.kind == 'say' && r.role == 'user'
    ? 'waiting for response…'
    : starting
    ? 'starting…'
    : 'working…'

export let SessionObservation = (
  { state, repo }: { state: ObservationState; repo?: string },
) => (
  <Transient>
    {(state.items ?? []).map((item, i) =>
      item.kind == 'reasoning'
        ? (
          <EntryBody
            key={i}
            x={{
              seq: i,
              line: '',
              row: { kind: 'reason', text: item.text },
            }}
          />
        )
        : item.kind == 'tool'
        ? <ToolSummary key={i} name={item.name} status='preparing…' />
        : (
          <EntryBody
            key={i}
            x={{
              seq: i,
              line: '',
              row: { kind: 'say', role: 'agent', text: item.text },
            }}
            repo={repo}
          />
        )
    )}
  </Transient>
)

export let observing = (state?: ObservationState) => {
  let item = state?.items.at(-1)
  return item?.kind == 'tool'
    ? `preparing ${item.name}…`
    : item?.kind == 'model'
    ? 'responding…'
    : item?.kind == 'reasoning'
    ? 'thinking…'
    : undefined
}

// A named fact, present only when there IS one — absence says enough.
let Fact = ({ k, v }: { k: string; v?: string | null }) =>
  v
    ? (
      <>
        <Key>{k}</Key>
        <Val>{v}</Val>
      </>
    )
    : null

// Task, role and lifecycle are one summary lane. The timestamp sits below
// what the session serves instead of reserving a header column of its own.
export let SessionSummary = ({ e, gist }: { e: Ent; gist: string }) => {
  let s = e.session!
  return (
    <Summary>
      {s.requested_task && <Entity eid={s.requested_task} view='Inline' />}
      {s.role && <Entity eid={s.role} view='Inline' />}
      <Facts>
        <Gist>{gist}</Gist>
        <Kv>
          <Fact k='id' v={s.id} />
          <Fact k='branch' v={s.branch} />
          <Fact k='cwd' v={s.cwd} />
          {
            /* The one irreducible difference, said rather than left blank:
            a session we watch is a pid, not a child — so no exit code. */
          }
          {s.origin != 'managed' && (
            <Fact k='pid' v={s.pid ? `${s.pid}` : null} />
          )}
          <Fact k='started' v={when(s.started_at)} />
          <Fact k='finished' v={when(s.finished_at)} />
        </Kv>
        <Stamp e={e} />
      </Facts>
    </Summary>
  )
}

export let SessionContext = ({ tokens }: { tokens?: number }) =>
  tokens ? <Context>{kilo(tokens)} context</Context> : null

export let SessionDiagnostics = ({
  stderr,
  exit,
  open,
}: {
  stderr?: string
  exit?: number | null
  open?: boolean
}) =>
  stderr
    ? (
      <Diagnostics open={open}>
        <Gist>diagnostics · {lineLabel(stderr)}</Gist>
        <Err mod={exit != null && exit != 0 && 'fail'}>
          <Ansi text={stderr} />
        </Err>
      </Diagnostics>
    )
    : null

// The raw event, pretty when it parses — the whole line, nothing elided.
// (ui's `pretty` is the locale timestamp; the suffix keeps them apart.)
let prettyJson = (line: string) => {
  try {
    return JSON.stringify(JSON.parse(line), null, 2)
  } catch {
    return line
  }
}

// Process logs have only bytes, while graph-native entries have an eid and
// therefore take every face through the renderer registry.
export let SessionEntry = (
  { x, repo, onOpen }: { x: Entry; repo?: string; onOpen?: () => void },
) => {
  if (!x.eid) return <EntryBody x={x} repo={repo} />
  let e = ent(x.eid)
  let face = resolve(e, 'Entry.Summary')
  return x.row && (face.Render == EntrySummary || face.view == 'JSON')
    ? <EntryBody x={x} repo={repo} />
    : <face.Render e={e} onOpen={onOpen} />
}

let Row = ({ x, repo }: { x: Entry; repo?: string }) => {
  let [open, setOpen] = useState(false)
  let at = x.row?.at
  return (
    <Line mod={open && 'open'}>
      <Seq
        type='button'
        aria-label={`${open ? 'hide' : 'show'} event ${x.seq} details`}
        data-tip={open ? undefined : 'the raw event'}
        onClick={() => setOpen(!open)}
      >
        {x.seq}
      </Seq>
      <Content>
        {at && <When data-tip={pretty(at)}>{ago(at)}</When>}
        <SessionEntry x={x} repo={repo} onOpen={() => setOpen(true)} />
      </Content>
      {open &&
        (x.eid ? <EntryLens eid={x.eid} /> : <Json>{prettyJson(x.line)}</Json>)}
    </Line>
  )
}

// Read the whole log, then keep reading the rest of it. `seq` is how far
// we've got: `after=0` is the entire file, and every read after that asks
// only for lines past the last one in hand, appended — the log grows by
// its delta, so a long transcript is paid for once. `live` is in the deps
// on purpose: when the status flips to an ending the effect re-runs, which
// reads once more (the bytes a child writes on its way out are the
// important ones) and leaves no timer behind.
let useLog = (eid: string, live: boolean) => {
  let [log, setLog] = useState<Log>({ entries: [] })
  let seq = useRef(0)
  // Another session is another log — never append one onto the other.
  // Declared first, so an eid change resets before the read below runs.
  useEffect(() => {
    seq.current = 0
    setLog({ entries: [] })
  }, [eid])
  useEffect(() => {
    let go = true
    let read = async () => {
      try {
        let r = await fetch(
          `${base()}/sessions/${eid}/logs?after=${seq.current}`,
        )
        let l: Log = await r.json()
        if (!go) return
        seq.current = l.entries.at(-1)?.seq ?? seq.current
        // stderr comes whole every time (it has no seqs to page), so it
        // replaces; entries accrue.
        setLog((was) => ({
          entries: l.entries.length
            ? [...was.entries, ...l.entries]
            : was.entries,
          stderr: l.stderr,
          context: l.context ?? was.context,
        }))
      } catch { /* a server that's away comes back — the next tick reads */ }
    }
    read()
    let t = live ? setInterval(read, 2000) : null
    return () => {
      go = false
      if (t) clearInterval(t)
    }
  }, [eid, live])
  return log
}

// The transcript's scroller, or the nearest host still owning that job.
// Null in the TUI's fake DOM (no parentElement), which switches the feature
// off there.
let scrollerOf = (n: HTMLElement | null) => {
  // No getComputedStyle off the browser (TUI fake DOM, linkedom mounts): there
  // is no scroller to find, so tail-pin/auto-grow simply switch off.
  if (typeof getComputedStyle != 'function') return null
  for (let s = n; s; s = s.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(s).overflowY)) return s
  }
  return null
}

// The transcript is windowed from its tail: a long log renders only its last
// WINDOW rows — the newest lines are the news — and grows older as the reader
// nears the top, so opening a thousand-line session pays for a screenful, not
// the whole file (rendering every row was ~4.6s of vnode work). Growth is
// anchored by distance-from-bottom, an invariant across a prepend, so older
// rows never jump the view.
//
// Follow the tail: while the reader sits at the scroller's end, each new log
// row pins it there again and the window slides (bounded); scroll up and it
// stays put — and a new tail row then widens the window instead of letting the
// start advance and unmount the row being read. Stickiness is sampled on scroll
// events (before new rows land — right after a render the end has already moved
// and measuring would always say "not at end"). The programmatic pin fires a
// scroll event too, re-arming itself.
//
// `enabled` is false in the TUI (no real scroller / getComputedStyle): there
// the whole log renders as before, since the terminal owns its own scrollback.
let WINDOW = 200
let useTranscript = (
  total: number,
  tail: string | number,
  enabled: boolean,
  session: string,
) => {
  let frame = useRef<HTMLDivElement>(null)
  let stuck = useRef(true)
  let [shown, setShown] = useState(WINDOW)
  let anchor = useRef<number | null>(null)
  let start = enabled ? Math.max(0, total - shown) : 0
  // A new session starts back at its own tail.
  useEffect(() => setShown(WINDOW), [session])

  // Reveal older rows, holding the reader's place: distance from the bottom is
  // invariant across a prepend, so restoring it after the grow keeps the view.
  let older = () => {
    if (anchor.current != null) return
    let s = scrollerOf(frame.current)
    anchor.current = s ? s.scrollHeight - s.scrollTop : 0
    setShown((n) => n + WINDOW)
  }
  useLayoutEffect(() => {
    if (anchor.current == null) return
    let s = scrollerOf(frame.current)
    if (s) s.scrollTop = s.scrollHeight - anchor.current
    anchor.current = null
  }, [shown])

  // One scroll listener samples stickiness and auto-grows near the top.
  let startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    let s = scrollerOf(frame.current)
    if (!s) return
    let sample = () => {
      // within a scrollbar-rounding of the end still counts as AT it
      stuck.current = s.scrollTop + s.clientHeight >= s.scrollHeight - 4
      if (startRef.current > 0 && s.scrollTop < 400) older()
    }
    s.addEventListener('scroll', sample)
    return () => s.removeEventListener('scroll', sample)
  }, [])

  // A new tail row: when the reader has scrolled up, widen the window by the
  // delta so `start` holds and no top row unmounts (in a layout effect, so the
  // corrected window is committed before paint — no flash). While stuck, let it
  // slide; the pin below keeps the bottom in view.
  let seen = useRef(total)
  useLayoutEffect(() => {
    let d = total - seen.current
    seen.current = total
    if (d > 0 && !stuck.current) setShown((n) => n + d)
  }, [total])

  // Pin the bottom while stuck (the tail moved).
  useLayoutEffect(() => {
    if (!stuck.current) return
    let s = scrollerOf(frame.current)
    if (s) s.scrollTop = s.scrollHeight
  }, [tail])

  return { frame, start, older }
}

export let Session = ({ e }: { e: Ent }) => {
  let s = e.session!
  let repo = repoUrl(e)
  // One predicate for every surface (types.ts): a session we spawned says
  // it's going in its status, one that only announced itself is going while
  // its door is open. `standing` is that answer as a word, so an external
  // run's pip and label read `running` instead of a blank lifecycle.
  let state = useSessionStanding(e)
  let entries = state.log
  let native = s.origin == 'managed' && s.status == null &&
    e.spawn?.provider == 'codex'
  let stream = native ? observation(e.eid) : undefined
  let live = native ? !s.base_revision || !!entries?.busy : awake(s)
  let status = state.status
  let fault = e.exception?.message ?? e.error?.message
  let file = useLog(e.eid, !native && live)
  let log = native ? entries ?? graphLog([]) : file
  let context = log.context ??
    log.entries.findLast((x) => x.row?.context)?.row?.context
  // The Final block IS the last agent say — don't print it twice. Only a
  // session whose log grew no say row (an external one, a torn log) still
  // leans on final_text.
  let said = log.entries.some(
    (x) => x.row?.kind == 'say' && x.row.role == 'agent',
  )
  let rows = squeeze(log.entries.filter(entryVisible))
  // The facts fold behind the one lifecycle fact worth keeping in the bar.
  let gist = live
    ? s.started_at ? `started ${ago(s.started_at)}` : 'starting'
    : native && log.entries.length
    ? 'idle'
    : s.started_at
    ? `started ${ago(s.started_at)}`
    : 'not started'
  // A comment joins the thread once the session has HEARD it: a managed
  // resume prints the words as its own `session.input` line (the log IS
  // the delivery — the comment would double it, so it hides), and the
  // `notified` stamp covers what a live run was served. An event comment
  // is machinery narrating and the session's own note is the agent
  // speaking — both already part of the story. Anything else is still in
  // flight: it waits under the log until the agent takes it.
  let inputs = new Set(
    log.entries.flatMap((x) =>
      x.row?.kind == 'say' && x.row.role == 'user' ? [x.row.text] : []
    ),
  )
  let cs = commentsOn(e.eid).filter((c) => !inputs.has(c.doc?.body ?? ''))
  let heard = (c: Ent) => c.created?.via == e.eid || !!c.notified
  let heardCs = cs.filter(heard)
  let thread = weave(rows, heardCs)
  // Windowed from the tail on the web; the whole thread in the TUI.
  let { frame, start, older } = useTranscript(
    thread.length,
    `${log.entries.at(-1)?.seq ?? 0}:${stream?.rev ?? 0}`,
    // Window on a real element tree (browser + linkedom mounts); render the
    // whole log in the TUI, whose fake document has no querySelector and owns
    // its own scrollback.
    typeof document != 'undefined' &&
      typeof document.querySelector == 'function',
    e.eid,
  )
  let windowed = start > 0 ? thread.slice(start) : thread
  let unsent = cs.filter((c) => !heard(c))
  // The mention scan (mdMentions over the whole thread) is a per-render scan we
  // can't pay — a 14M-log session stalled first paint on it. Parse once,
  // memoized on the cheap content signature; resolve+dedup stays per render so a
  // late-loading eid still links.
  let sig = mentionSig({
    count: log.entries.length,
    seq: log.entries.at(-1)?.seq ?? 0,
    rev: stream?.rev ?? 0,
    said,
    final: s.final_text ?? '',
    heard: heardCs,
    repo,
  })
  let raw = useMemo(
    () =>
      threadMentions([
        ...(!said && s.final_text
          ? [{
            row: {
              kind: 'say' as const,
              role: 'agent' as const,
              text: s.final_text,
            },
          }]
          : []),
        ...thread,
      ], repo),
    [sig],
  )
  let mentions = resolveMentions(raw)
  let graphActivity = native ? entries?.activity : undefined
  let activity = graphActivity?.kind == 'tool'
    ? graphActivity.label
    : observing(stream) ?? graphActivity?.label ??
      doing(
        rows.at(-1)?.row,
        s.turn ?? (status == 'idle' ? 'idle' : undefined),
        !s.started_at,
      )
  let showActivity = live || status == 'idle'
  return (
    <Frame>
      <Head>
        <Dot status={status} />
        <SessionSummary e={e} gist={gist} />
        <SessionContext tokens={context} />
        {
          /* No brake on a process we never forked — apply() refuses a
            stop_request at anything but a managed run, and the button
            shouldn't offer what the graph will bounce. */
        }
        {live && s.origin == 'managed' && (
          <Stop
            type='button'
            onClick={() =>
              // The brake is data: a stop_request entity aimed here — the
              // server's effect signals the group and stamps the ending.
              mutate({
                eid: uuid(),
                name: 'stop_request',
                comp: { target: e.eid },
              })}
          >
            ■ stop
          </Stop>
        )}
      </Head>
      <Panel elRef={frame}>
        {/* markdown, escaped of any markup by md.ts — as with a task body */}
        {!said && s.final_text && (
          <Markdown as={Final} text={s.final_text} repo={repo} />
        )}
        {fault && <Fault mod='error'>{fault}</Fault>}
        {s.stop_reason && <Fault>{s.stop_reason}</Fault>}
        <Log>
          {start > 0 && (
            <Earlier type='button' onClick={older}>
              ↑ {start} earlier {start == 1 ? 'line' : 'lines'}
            </Earlier>
          )}
          {windowed.map((x) =>
            'seq' in x
              ? <Row key={x.seq} x={x} repo={repo} />
              : <Note key={x.eid} c={x} />
          )}
          {stream && <SessionObservation state={stream} repo={repo} />}
          {showActivity && <Think>✳ {activity}</Think>}
        </Log>
        {
          /* stderr is durable evidence, not transcript: it has no seqs and
            resumes append to it. Routine noise folds; failed runs show it. */
        }
        <SessionDiagnostics
          stderr={log.stderr}
          exit={s.exit_code}
          open={status == 'failed'}
        />
        {unsent.length > 0 && (
          <Unsent>
            {unsent.map((c) => <Note key={c.eid} c={c} />)}
          </Unsent>
        )}
      </Panel>
      <SessionReferences items={mentions} />
      {
        /* the one composer, pinned like the bar: comment about it, or say
          TO it (Comments.tsx knows which sessions can take words) */
      }
      <Foot>
        <Composer eid={e.eid} entry={native} />
      </Foot>
    </Frame>
  )
}

// A session Tile is a model-information line followed by every task the
// session has worked on. Each line keeps its own link target.
let RowLine = block('div', 'SessionRow', {
  Head: 'div',
  Identity: 'span',
  Model: 'span',
  Effort: 'span',
  Tasks: 'div',
  Task: 'span',
})

let SessionTile = (
  { e, slots, onOpen, chip = true }: TileProps & { chip?: boolean },
) => {
  let s = e.session!
  let tasks = e.refs.filter((r) => r.type == 'worked').map((r) => ent(r.child))
    .filter((x) => x.task)
  let persona = s.persona ? ent(s.persona) : undefined
  let actor = s.actor ? ent(s.actor) : undefined
  let identity = persona ?? actor
  let model = s.serving_model || s.model
  return (
    <RowLine>
      <RowLine.Head {...tileLink(e, onOpen)}>
        {slot(slots, 'before')}
        <SessionDot e={e} />
        {slots?.title != null ? <RowLine.Model {...tileTitle(slots, '')} /> : (
          <>
            {identity && (
              <RowLine.Identity>
                {identity.doc?.title || idOf(identity)}
              </RowLine.Identity>
            )}
            {model && <RowLine.Model>{friendly(model)}</RowLine.Model>}
            {s.effort && <RowLine.Effort>{s.effort}</RowLine.Effort>}
          </>
        )}
        {chip && <Id e={e} />}
        {slot(slots, 'after')}
        <Stamp at={e.created?.at} />
      </RowLine.Head>
      {slot(slots, 'body')}
      {tasks.length > 0 && (
        <RowLine.Tasks>
          {tasks.map((task) => (
            <RowLine.Task key={task.eid}>
              <Entity eid={task.eid} view='Inline' />
            </RowLine.Task>
          ))}
        </RowLine.Tasks>
      )}
    </RowLine>
  )
}

export let SessionRow = (props: TileProps) => <SessionTile {...props} />

export let SessionLiveRow = (props: TileProps) => (
  <SessionTile {...props} chip={false} />
)
