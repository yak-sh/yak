import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { awake, type Ent, friendly, kilo, type LogRow } from '../../types.ts'
import {
  base,
  commentsOn,
  ent,
  findEid,
  jobOf,
  mutate,
  observation,
  repoUrl,
  uuid,
} from '../../live.ts'
import { graphLog } from '../../entry_log.ts'
import { type ObservationState } from '../../observations.ts'
import { slot, tileLink, type TileProps } from '../Tile.tsx'
import { ago, block, pretty, Stamp } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Composer, Note } from '../Comments.tsx'
import { Id } from './Inline.tsx'
import { Entity, resolve } from '../Entity.tsx'
import { title } from '../title.tsx'
import { Markdown } from '../Markdown.tsx'
import { mdMentions } from '../../md.ts'
import { UrlVal } from '../editors.tsx'
import { Ansi } from '../Ansi.tsx'
import { SessionDot, useSessionStanding } from '../session_status.tsx'
import { EntryLens, EntrySummary } from './Entry.tsx'

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
  Line: 'div',
  Content: 'div',
  Seq: 'button',
  When: 'time',
  Raw: 'span',
  Agent: 'div',
  User: 'div',
  Reason: 'div',
  Tool: 'div',
  ToolName: 'span',
  ToolDetail: 'span',
  ToolStatus: 'span',
  ToolErr: 'span',
  Exec: 'div',
  ExecHead: 'div',
  ExecCommand: 'code',
  ExecDesc: 'span',
  ExecStatus: 'span',
  Turn: 'div',
  Oops: 'div',
  Err: 'pre',
  Json: 'pre',
  Sys: 'div',
  SysTag: 'span',
  SysText: 'span',
  SysCount: 'span',
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
  Line,
  Content,
  Seq,
  When,
  Raw,
  Agent,
  User,
  Reason,
  Tool,
  ToolName,
  ToolDetail,
  ToolStatus,
  ToolErr,
  Exec,
  ExecHead,
  ExecCommand,
  ExecDesc,
  ExecStatus,
  Turn,
  Oops,
  Err,
  Json,
  Sys,
  SysTag,
  SysText,
  SysCount,
  Unsent,
  Foot,
} = Frame

type Entry = {
  eid?: string
  seq: number
  line: string
  row?: LogRow
  n?: number
}
type Log = { entries: Entry[]; stderr?: string; context?: number }
type Mentioned =
  | { kind: 'entity'; eid: string }
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

// A duration a human reads: 42s, 1m 40s.
let span = (ms: number) => {
  let s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

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

let mentionText = (x: { row?: LogRow } | Ent) => {
  if ('eid' in x) return [x.doc?.body ?? '']
  let r = x.row
  return r?.kind == 'say' ? [r.text] : []
}

// The first mention wins its place. Entity spellings dedupe by the entity
// they resolve to, so a labeled link and a later bare id still make one row.
export let sessionMentions = (
  thread: ({ row?: LogRow } | Ent)[],
  repo?: string,
): Mentioned[] => {
  let out: Mentioned[] = []
  let seen = new Set<string>()
  for (let text of thread.flatMap(mentionText)) {
    for (let mention of mdMentions(text, repo)) {
      let item: Mentioned | undefined
      if (mention.kind == 'entity') {
        let eid = findEid(mention.id)
        if (eid) item = { kind: 'entity', eid }
      } else item = mention
      if (!item) continue
      let key = item.kind == 'entity'
        ? `entity:${item.eid}`
        : `link:${item.href}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push(item)
      }
    }
  }
  return out
}

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
          <Reference key={item.kind == 'entity' ? item.eid : item.href}>
            {item.kind == 'entity'
              ? <Entity eid={item.eid} view='Inline' />
              : UrlVal(item.href)}
          </Reference>
        ))}
      </ReferencesList>
    </References>
  )
}

// The tail thinks out loud: what the run is doing right now, read off
// its newest row — thinking (with the streaming token count when the
// squeeze kept one) or just working between events.
let doing = (r?: LogRow) =>
  r?.kind == 'reason'
    ? 'thinking…'
    : r?.kind == 'sys' && r.tag == 'thinking'
    ? (r.text ? `thinking · ${r.text}` : 'thinking…')
    : 'working…'

export let SessionObservation = (
  { state, repo }: { state: ObservationState; repo?: string },
) => (
  <Transient>
    {(state.items ?? []).map((item, i) =>
      item.kind == 'reasoning'
        ? <Reason key={i}>{item.text}</Reason>
        : item.kind == 'tool'
        ? (
          <Tool key={i}>
            <ToolName>{item.name}</ToolName>
            <ToolStatus>preparing…</ToolStatus>
          </Tool>
        )
        : <Markdown key={i} as={Agent} text={item.text} repo={repo} />
    )}
  </Transient>
)

let observing = (state?: ObservationState) =>
  state?.tools.at(-1)
    ? `preparing ${state.tools.at(-1)}…`
    : state?.model
    ? 'responding…'
    : state?.reasoning
    ? 'thinking…'
    : undefined

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

// Usage, said the compact way: ↑ everything sent up (input plus both
// cache lanes), ↓ what came back.
let usage = (json?: string) => {
  if (!json) return ''
  try {
    let u = JSON.parse(json) as Record<string, number>
    let up = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0)
    let down = u.output_tokens ?? 0
    return [up > 0 && `↑ ${kilo(up)}`, down > 0 && `↓ ${kilo(down)}`]
      .filter(Boolean).join('  ')
  } catch {
    return ''
  }
}

// The type of a line the adapter had no row for — just enough to place it,
// or null when it isn't JSON at all (a provider printing over its stream).
let bareType = (line: string) => {
  try {
    return String((JSON.parse(line) as { type?: unknown }).type ?? '?')
  } catch {
    return null
  }
}

// The transcript face of a line, matched on the normalized row
// (adapters.ts). JSON the adapter left out is provider machinery, not a
// chat item. Non-JSON bytes stay visible because they are evidence of a
// broken stream, not a dialect the adapter deliberately ignored.
export let SessionBody = ({ x, repo }: { x: Entry; repo?: string }) => {
  let r = x.row
  if (!r) {
    let t = bareType(x.line)
    return t ? null : (
      <Raw>
        <Ansi text={x.line} />
      </Raw>
    )
  }
  switch (r.kind) {
    case 'say':
      // markdown, escaped of any markup by md.ts — as with a task body
      return r.role == 'user'
        ? <Markdown as={User} text={r.text} repo={repo} />
        : <Markdown as={Agent} text={r.text} repo={repo} />
    case 'reason':
      return (
        <Reason>
          <Ansi text={r.text} />
        </Reason>
      )
    case 'tool':
      return (
        <Tool mod={r.ok === false && 'fail'}>
          <ToolName>{r.name}</ToolName>
          {r.detail && (
            <ToolDetail>
              <Ansi text={r.detail} />
            </ToolDetail>
          )}
          {r.ok != null && (
            <ToolStatus>{r.ok ? '✓ done' : '✗ failed'}</ToolStatus>
          )}
          {r.error && (
            <ToolErr>
              <Ansi text={r.error} />
            </ToolErr>
          )}
        </Tool>
      )
    case 'exec': {
      let failed = r.exit != null ? r.exit != 0 : r.status == 'failed'
      let status = r.exit != null
        ? `${failed ? '✗' : '✓'} exit ${r.exit}`
        : r.status
      return (
        <Exec mod={failed ? 'fail' : status ? 'ok' : undefined}>
          <ExecHead>
            <ExecDesc>{r.desc || 'Command'}</ExecDesc>
            {status && <ExecStatus>{status}</ExecStatus>}
          </ExecHead>
          <ExecCommand>
            $ <Ansi text={r.command} />
          </ExecCommand>
        </Exec>
      )
    }
    case 'turn':
      return (
        <Turn>
          {[
            r.model && friendly(r.model),
            r.ms != null && span(r.ms),
            usage(r.usage),
          ]
            .filter(Boolean).join(' · ')}
        </Turn>
      )
    case 'error':
      return (
        <Oops>
          <Ansi text={r.text} />
        </Oops>
      )
    case 'sys':
      return (
        <Sys>
          <SysTag>{r.tag}</SysTag>
          {r.text && (
            <SysText>
              <Ansi text={r.text} />
            </SysText>
          )}
          {(x.n ?? 1) > 1 && <SysCount>×{x.n}</SysCount>}
        </Sys>
      )
  }
}

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
  if (!x.eid) return <SessionBody x={x} repo={repo} />
  let e = ent(x.eid)
  let face = resolve(e, 'Entry.Summary')
  return face.Render == EntrySummary && x.row
    ? <SessionBody x={x} repo={repo} />
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
  for (let s = n; s; s = s.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(s).overflowY)) return s
  }
  return null
}

// Follow the tail: while the reader sits at the scroller's end, each new
// log row pins it there again; scroll up and it stays put, return to the
// end and it follows once more. Stickiness is sampled on scroll events —
// BEFORE new rows land, because right after a render the end has already
// moved and measuring would always say "not at end". The programmatic
// pin fires a scroll event too, re-arming itself.
let useTail = (tail?: string | number) => {
  let frame = useRef<HTMLDivElement>(null)
  // Every session opens at the END of its log — the newest lines are the
  // news, and now that the whole transcript loads, the top is a thousand
  // lines from what just happened. A finished one pins once (its seq never
  // moves again) and stays wherever the reader takes it.
  let stuck = useRef(true)
  useEffect(() => {
    let s = scrollerOf(frame.current)
    if (!s) return
    let sample = () => {
      // within a scrollbar-rounding of the end still counts as AT it
      stuck.current = s.scrollTop + s.clientHeight >= s.scrollHeight - 4
    }
    s.addEventListener('scroll', sample)
    return () => s.removeEventListener('scroll', sample)
  }, [])
  useLayoutEffect(() => {
    if (!stuck.current) return
    let s = scrollerOf(frame.current)
    if (s) s.scrollTop = s.scrollHeight
  }, [tail])
  return frame
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
  let file = useLog(e.eid, !native && live)
  let log = native ? entries ?? graphLog([]) : file
  let context = log.context ??
    log.entries.findLast((x) => x.row?.context)?.row?.context
  let frame = useTail(`${log.entries.at(-1)?.seq ?? 0}:${stream?.rev ?? 0}`)
  // The Final block IS the last agent say — don't print it twice. Only a
  // session whose log grew no say row (an external one, a torn log) still
  // leans on final_text.
  let said = log.entries.some(
    (x) => x.row?.kind == 'say' && x.row.role == 'agent',
  )
  let rows = squeeze(log.entries.filter((x) => x.row || !bareType(x.line)))
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
  let thread = weave(rows, cs.filter(heard))
  let unsent = cs.filter((c) => !heard(c))
  let mentions = sessionMentions([
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
  ], repo)
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
        {e.error?.message && <Fault mod='error'>{e.error.message}</Fault>}
        {s.stop_reason && <Fault>{s.stop_reason}</Fault>}
        <Log>
          {thread.map((x) =>
            'seq' in x
              ? <Row key={x.seq} x={x} repo={repo} />
              : <Note key={x.eid} c={x} />
          )}
          {stream && <SessionObservation state={stream} repo={repo} />}
          {live && (
            <Think>✳ {observing(stream) ?? doing(rows.at(-1)?.row)}</Think>
          )}
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

// A session in a list: the dot carries the status, the way a task row's
// does — plus what it's running and the task it's ON (jobOf: the claim
// is the truth, the managed request the fallback). The whole tile is the
// LINK (clickProps on the el: click peeks, double click navigates).
let RowLine = block('div', 'SessionRow', {
  Status: 'span',
  Model: 'span',
  Actor: 'span',
  Task: 'span',
})

export let SessionRow = ({ e, slots, onOpen }: TileProps) => {
  let s = e.session!
  let job = jobOf(e)
  let model = s.serving_model || s.model
  return (
    <RowLine {...tileLink(e, onOpen)}>
      {slot(slots, 'before')}
      <SessionDot e={e} />
      {model && <RowLine.Model>{friendly(model)}</RowLine.Model>}
      {s.actor && <RowLine.Actor {...title(ent(s.actor).doc?.title ?? '')} />}
      {job && <RowLine.Task {...title(ent(job).doc?.title ?? '')} />}
      <Id e={e} />
      {slot(slots, 'after')}
    </RowLine>
  )
}
