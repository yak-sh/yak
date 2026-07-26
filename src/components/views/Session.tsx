import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { md } from '../../md.ts'
import {
  type Ent,
  friendly,
  kilo,
  type LogRow,
  sessionActive,
} from '../../types.ts'
import { base, ent, jobOf, mutate, uuid } from '../../live.ts'
import { clickProps } from '../nav.tsx'
import { ago, block, pretty, Stamp } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Comments } from '../Comments.tsx'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'

// An agent session, watched — the console (W-3676 #5): a sticky slim bar
// (status, model, stop) over the lifecycle summary (server-owned columns,
// riding the snapshot like any component — so the bar re-renders itself
// off the cache as the run moves), the facts behind a disclosure, then
// the log, then the comment rail (Comments.tsx), which doubles as the
// way to talk TO the agent.
//
// The log is the FILE (src/sessions.ts): we read it back over
// /sessions/:eid/logs, where each line already carries its renderer `row`
// (the server's adapter normalized the provider's dialect — the browser
// never learns one). We match on row.kind, so a say is markdown, a tool a
// chip, reasoning dim — the pane reads like a transcript, not a dump. A
// line with no row (a heartbeat, a torn frame) falls back to its bare type.
// The WHOLE log, always: the first read takes every line, and the poll
// asks only for what came after (useLog) — so showing all of it costs one
// read, not one per tick.

let Frame = block('div', 'Session', {
  Head: 'div',
  Status: 'span',
  Model: 'span',
  Stop: 'button',
  Body: 'div',
  Facts: 'details',
  Gist: 'summary',
  Kv: 'div',
  Key: 'span',
  Val: 'span',
  Think: 'div',
  Final: 'div',
  Fault: 'p',
  Log: 'div',
  Line: 'div',
  Seq: 'span',
  When: 'time',
  Type: 'span',
  Raw: 'span',
  Agent: 'div',
  User: 'div',
  Reason: 'div',
  Tool: 'div',
  ToolName: 'span',
  ToolDetail: 'span',
  ToolErr: 'span',
  Exec: 'div',
  ExecDesc: 'span',
  Turn: 'div',
  Oops: 'div',
  Err: 'pre',
  Json: 'pre',
  Sys: 'div',
  SysTag: 'span',
  SysText: 'span',
  SysCount: 'span',
})
let {
  Head,
  Status,
  Model,
  Stop,
  Body: Panel,
  Facts,
  Gist,
  Kv,
  Key,
  Val,
  Think,
  Final,
  Fault,
  Log,
  Line,
  Seq,
  When,
  Type,
  Raw,
  Agent,
  User,
  Reason,
  Tool,
  ToolName,
  ToolDetail,
  ToolErr,
  Exec,
  ExecDesc,
  Turn,
  Oops,
  Err,
  Json,
  Sys,
  SysTag,
  SysText,
  SysCount,
} = Frame

type Entry = { seq: number; line: string; row?: LogRow; n?: number }
type Log = { entries: Entry[]; stderr?: string }

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

// The facts line's clock: the time of day says enough for "started" —
// messages wear the house timestamp (ago + pretty tooltip) instead.
let clock = (t: string) =>
  new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

// A duration a human reads: 42s, 1m 40s.
let span = (ms: number) => {
  let s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
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
// (adapters.ts). No row means the adapter didn't recognize it: show its
// bare type, as the dump did.
let Body = ({ x }: { x: Entry }) => {
  let r = x.row
  if (!r) {
    let t = bareType(x.line)
    return t ? <Type>{t}</Type> : <Raw>{x.line}</Raw>
  }
  switch (r.kind) {
    case 'say':
      // our own data, so no sanitizer — as with a task body
      return r.role == 'user'
        ? <User>{r.text}</User>
        : <Agent dangerouslySetInnerHTML={{ __html: md(r.text) }} />
    case 'reason':
      return <Reason>{r.text}</Reason>
    case 'tool':
      return (
        <Tool mod={r.ok === false && 'fail'}>
          <ToolName>
            {r.name}
            {r.ok === false ? ' ✗' : r.ok ? ' ✓' : ''}
          </ToolName>
          {r.detail && <ToolDetail>{r.detail}</ToolDetail>}
          {r.error && <ToolErr>{r.error}</ToolErr>}
        </Tool>
      )
    case 'exec':
      return (
        <Exec>
          {r.command}
          {r.exit != null && r.exit != 0 && ` · exit ${r.exit}`}
          {r.desc && <ExecDesc>{r.desc}</ExecDesc>}
        </Exec>
      )
    case 'turn':
      return (
        <Turn>
          {[r.ms != null && span(r.ms), usage(r.usage)]
            .filter(Boolean).join(' · ')}
        </Turn>
      )
    case 'error':
      return <Oops>{r.text}</Oops>
    case 'sys':
      return (
        <Sys>
          <SysTag>{r.tag}</SysTag>
          {r.text && <SysText>{r.text}</SysText>}
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

// One log line: a seq gutter, the transcript face, and — a click on the
// seq away — the raw event. The log lines aren't entities on purpose
// (the FILE is the durable log), so this is where inspection lives: any
// row, a system frame or a truncated tool chip alike, opens to the full
// JSON the provider actually wrote.
let Row = ({ x }: { x: Entry }) => {
  let [open, setOpen] = useState(false)
  let at = x.row?.kind == 'say' ? x.row.at : undefined
  return (
    <Line>
      <Seq
        data-tip={open ? undefined : 'the raw event'}
        onClick={() => setOpen(!open)}
      >
        {x.seq}
      </Seq>
      <Body x={x} />
      {at && <When data-tip={pretty(at)}>{ago(at)}</When>}
      {open && <Json>{prettyJson(x.line)}</Json>}
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

// The host's scroller — a card's Card_Scroll, the fullscreen App_Body —
// found by walking up to the nearest ancestor that scrolls. Null in the
// TUI's fake DOM (no parentElement), which switches the feature off there.
let scrollerOf = (n: HTMLElement | null) => {
  for (let s = n?.parentElement; s; s = s.parentElement) {
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
let useTail = (seq?: number) => {
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
  }, [seq])
  return frame
}

export let Session = ({ e }: { e: Ent }) => {
  let s = e.session!
  let status = s.status ?? ''
  // A session we spawned says it's going in its status; one that only
  // announced itself has no status to say it with — it is going while it
  // has a claude process and the server hasn't seen that door shut
  // (sessions.ts watched()).
  let live = sessionActive.includes(status) || (!!s.pid && !s.finished_at)
  let log = useLog(e.eid, live)
  let frame = useTail(log.entries.at(-1)?.seq)
  // The Final block IS the last agent say — don't print it twice. Only a
  // session whose log grew no say row (an external one, a torn log) still
  // leans on final_text.
  let said = log.entries.some(
    (x) => x.row?.kind == 'say' && x.row.role == 'agent',
  )
  let rows = squeeze(log.entries)
  // The facts fold behind one dim line — the mock's disclosure summary.
  let gist = [
    s.branch,
    s.cwd,
    s.started_at && `started ${clock(s.started_at)}`,
  ].filter(Boolean).join(' · ') || 'session'
  return (
    <Frame elRef={frame}>
      <Head>
        <Dot status={status} />
        <Status mod={status}>{status || 'external'}</Status>
        {(s.serving_model || s.model) && (
          <Model>
            {friendly(s.serving_model || s.model)}
            {s.effort && ` · ${s.effort}`}
          </Model>
        )}
        {s.requested_task_eid && (
          <Entity eid={s.requested_task_eid} view='Inline' />
        )}
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
                comp: { target_eid: e.eid },
              })}
          >
            ■ stop
          </Stop>
        )}
      </Head>
      <Panel>
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
              <Fact
                k='pid'
                v={s.pid ? `${s.pid}` : null}
              />
            )}
            <Fact k='started' v={when(s.started_at)} />
            <Fact k='finished' v={when(s.finished_at)} />
          </Kv>
          <Stamp e={e} />
        </Facts>
        {/* markdown: our own data, so no sanitizer — as with a task body */}
        {!said && s.final_text && (
          <Final dangerouslySetInnerHTML={{ __html: md(s.final_text) }} />
        )}
        {s.error && <Fault mod='error'>{s.error}</Fault>}
        {s.stop_reason && <Fault>{s.stop_reason}</Fault>}
        <Log>
          {rows.map((x) => <Row key={x.seq} x={x} />)}
          {live && <Think>✳ {doing(rows.at(-1)?.row)}</Think>}
        </Log>
        {/* stderr: unordered diagnostics, never inside the log's seqs */}
        {log.stderr && <Err>{log.stderr}</Err>}
        {
          /* the one composer: comment about it, or arm → session to say TO
          it (Comments.tsx knows which sessions can take words) */
        }
        <Comments eid={e.eid} />
      </Panel>
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
  Task: 'span',
})

export let SessionRow = ({ e }: { e: Ent }) => {
  let s = e.session!
  let job = jobOf(e)
  return (
    <RowLine {...clickProps(e)}>
      <Dot status={s.status ?? ''} />
      {s.model && <RowLine.Model>{friendly(s.model)}</RowLine.Model>}
      {job && <RowLine.Task>{ent(job).doc?.title}</RowLine.Task>}
      <Id e={e} />
    </RowLine>
  )
}
