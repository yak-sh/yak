import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { md } from '../../md.ts'
import {
  awake,
  type Ent,
  friendly,
  kilo,
  type LogRow,
  standing,
} from '../../types.ts'
import {
  base,
  commentsOn,
  ent,
  jobOf,
  mutate,
  repoUrl,
  uuid,
} from '../../live.ts'
import { clickProps } from '../nav.tsx'
import { ago, block, pretty, Stamp } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Composer, Note } from '../Comments.tsx'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'
import { title } from '../title.tsx'

// An agent session, watched — the console (W-3676 #5): a sticky slim bar
// (task, lifecycle summary, stop — server-owned columns riding
// the snapshot like any component, so the bar re-renders itself as the
// run moves), the log with the session's comments woven in by time, then
// the pinned composer (Comments.tsx), which is the way to talk TO the
// agent.
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
  Stop: 'button',
  Body: 'div',
  Facts: 'details',
  Diagnostics: 'details',
  Gist: 'summary',
  Kv: 'div',
  Key: 'span',
  Val: 'span',
  Think: 'div',
  Final: 'div',
  Fault: 'p',
  Log: 'div',
  Line: 'div',
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
  Stop,
  Body: Panel,
  Facts,
  Diagnostics,
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
// (adapters.ts). JSON the adapter left out is provider machinery, not a
// chat item. Non-JSON bytes stay visible because they are evidence of a
// broken stream, not a dialect the adapter deliberately ignored.
let Body = ({ x, repo }: { x: Entry; repo?: string }) => {
  let r = x.row
  if (!r) {
    let t = bareType(x.line)
    return t ? null : <Raw>{x.line}</Raw>
  }
  switch (r.kind) {
    case 'say':
      // markdown, escaped of any markup by md.ts — as with a task body
      return r.role == 'user'
        ? <User>{r.text}</User>
        : <Agent dangerouslySetInnerHTML={{ __html: md(r.text, repo) }} />
    case 'reason':
      return <Reason>{r.text}</Reason>
    case 'tool':
      return (
        <Tool mod={r.ok === false && 'fail'}>
          <ToolName>{r.name}</ToolName>
          {r.detail && <ToolDetail>{r.detail}</ToolDetail>}
          {r.ok != null && (
            <ToolStatus>{r.ok ? '✓ done' : '✗ failed'}</ToolStatus>
          )}
          {r.error && <ToolErr>{r.error}</ToolErr>}
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
          <ExecCommand>$ {r.command}</ExecCommand>
        </Exec>
      )
    }
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
      <Body x={x} repo={repo} />
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
  let repo = repoUrl(e)
  // One predicate for every surface (types.ts): a session we spawned says
  // it's going in its status, one that only announced itself is going while
  // its door is open. `standing` is that answer as a word, so an external
  // run's pip and label read `running` instead of a blank lifecycle.
  let live = awake(s)
  let status = standing(s)
  let log = useLog(e.eid, live)
  let frame = useTail(log.entries.at(-1)?.seq)
  // The Final block IS the last agent say — don't print it twice. Only a
  // session whose log grew no say row (an external one, a torn log) still
  // leans on final_text.
  let said = log.entries.some(
    (x) => x.row?.kind == 'say' && x.row.role == 'agent',
  )
  let rows = squeeze(log.entries.filter((x) => x.row || !bareType(x.line)))
  // The facts fold behind the one lifecycle fact worth keeping in the bar.
  let gist = s.started_at ? `started ${ago(s.started_at)}` : 'not started'
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
  return (
    <Frame elRef={frame}>
      <Head>
        <Dot status={status} />
        {s.requested_task_eid && (
          <Entity eid={s.requested_task_eid} view='Inline' />
        )}
        {s.role_eid && <Entity eid={s.role_eid} view='Inline' />}
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
        {/* markdown, escaped of any markup by md.ts — as with a task body */}
        {!said && s.final_text && (
          <Final
            dangerouslySetInnerHTML={{ __html: md(s.final_text, repo) }}
          />
        )}
        {s.error && <Fault mod='error'>{s.error}</Fault>}
        {s.stop_reason && <Fault>{s.stop_reason}</Fault>}
        <Log>
          {thread.map((x) =>
            'seq' in x
              ? <Row key={x.seq} x={x} repo={repo} />
              : <Note key={x.eid} c={x} />
          )}
          {live && <Think>✳ {doing(rows.at(-1)?.row)}</Think>}
        </Log>
        {
          /* stderr is durable evidence, not transcript: it has no seqs and
            resumes append to it. Routine noise folds; failed runs show it. */
        }
        {log.stderr && (
          <Diagnostics open={status == 'failed'}>
            <Gist>diagnostics · {lineLabel(log.stderr)}</Gist>
            <Err>{log.stderr}</Err>
          </Diagnostics>
        )}
        {unsent.length > 0 && (
          <Unsent>
            {unsent.map((c) => <Note key={c.eid} c={c} />)}
          </Unsent>
        )}
      </Panel>
      {
        /* the one composer, pinned like the bar: comment about it, or say
          TO it (Comments.tsx knows which sessions can take words) */
      }
      <Foot>
        <Composer eid={e.eid} />
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

export let SessionRow = ({ e }: { e: Ent }) => {
  let s = e.session!
  let job = jobOf(e)
  let model = s.serving_model || s.model
  return (
    <RowLine {...clickProps(e)}>
      <Dot status={standing(s)} />
      {model && <RowLine.Model>{friendly(model)}</RowLine.Model>}
      {s.actor_eid && (
        <RowLine.Actor {...title(ent(s.actor_eid).doc?.title ?? '')} />
      )}
      {job && <RowLine.Task {...title(ent(job).doc?.title ?? '')} />}
      <Id e={e} />
    </RowLine>
  )
}
