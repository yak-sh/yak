import { useEffect, useState } from 'preact/hooks'
import snarkdown from 'snarkdown'
import { type Ent, sessionActive } from '../../types.ts'
import { base } from '../../live.ts'
import { block } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { View } from '../View.tsx'

// An agent session, watched: the lifecycle summary (server-owned columns,
// riding the snapshot like any component — so the head re-renders itself
// off the cache as the run moves), then its log.
//
// The log is the FILE (src/sessions.ts): we read it back over
// /sessions/:eid/logs rather than hold lines in the graph, and only while
// the session is still going — an ending stops the timer instead of a
// timer noticing the ending.

let Frame = block('div', 'Session', {
  Head: 'div',
  Status: 'span',
  Model: 'span',
  Stop: 'button',
  Facts: 'div',
  Key: 'span',
  Val: 'span',
  Final: 'div',
  Fault: 'p',
  Log: 'div',
  Line: 'div',
  Seq: 'span',
  Type: 'span',
  Say: 'span',
  Err: 'pre',
})
let {
  Head,
  Status,
  Model,
  Stop,
  Facts,
  Key,
  Val,
  Final,
  Fault,
  Log,
  Line,
  Seq,
  Type,
  Say,
  Err,
} = Frame

type Entry = { seq: number; line: string }
type Log = { entries: Entry[]; stderr?: string }
type Json = Record<string, unknown>

// ISO in the db; a local clock is what a human reads.
let when = (t?: string | null) => t ? new Date(t).toLocaleString() : null

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

let parse = (line: string): Json | null => {
  try {
    let e = JSON.parse(line)
    return e && typeof e == 'object' ? e as Json : null
  } catch {
    return null
  }
}

// The one interesting phrase in an event: what the agent SAID, the tool it
// reached for, the answer it gave. Each provider nests it somewhere else
// and adapters.ts — the server's own reader — imports Deno, so it's out of
// reach here: we go looking through the keys they all use rather than
// teach the browser three dialects. Anything we don't find is just its
// type, which the line already shows.
let phrase = (v: unknown): string => {
  if (typeof v == 'string') return v
  if (Array.isArray(v)) return v.map(phrase).filter(Boolean).join(' ')
  if (!v || typeof v != 'object') return ''
  for (
    let k of ['text', 'final_text', 'name', 'command', 'result', 'content']
  ) {
    let s = phrase((v as Json)[k])
    if (s) return s
  }
  // the wrappers: claude nests the turn under message, codex under item
  return phrase((v as Json).message) || phrase((v as Json).item)
}

// One log line: its type and its phrase — or, when it isn't JSON at all
// (a provider printing over its own stream), the bytes as written.
let Event = ({ x }: { x: Entry }) => {
  let e = parse(x.line)
  return (
    <Line>
      <Seq>{x.seq}</Seq>
      {e
        ? (
          <>
            <Type>{String(e.type ?? '?')}</Type>
            <Say>{phrase(e)}</Say>
          </>
        )
        : <Say mod='raw'>{x.line}</Say>}
    </Line>
  )
}

// Tail the log file. `live` is in the deps on purpose: when the status
// flips to an ending the effect re-runs, which reads once more (the bytes
// a child writes on its way out are the important ones) and leaves no
// timer behind.
let useLog = (eid: string, live: boolean) => {
  let [log, setLog] = useState<Log>({ entries: [] })
  useEffect(() => {
    let go = true
    let read = async () => {
      try {
        let r = await fetch(`${base()}/sessions/${eid}/logs?tail=100`)
        let l = await r.json()
        if (go) setLog(l)
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

export let Session = ({ e }: { e: Ent }) => {
  let s = e.session!
  let status = s.status ?? ''
  let live = sessionActive.includes(status)
  let log = useLog(e.eid, live)
  return (
    <Frame>
      <Head>
        <Dot status={status} />
        <Status mod={status}>{status || 'external'}</Status>
        {s.provider && (
          <Model>
            {s.provider} · {s.serving_model || s.model}
            {s.effort && ` · ${s.effort}`}
          </Model>
        )}
        {s.requested_task_eid && <View eid={s.requested_task_eid} view='Id' />}
        {live && (
          <Stop
            type='button'
            onClick={() =>
              fetch(`${base()}/sessions/${e.eid}/stop`, { method: 'POST' })
                .catch(() => {})}
          >
            ■ stop
          </Stop>
        )}
      </Head>
      <Facts>
        <Fact k='id' v={s.id} />
        <Fact k='branch' v={s.branch} />
        <Fact k='cwd' v={s.cwd} />
        <Fact k='started' v={when(s.started_at)} />
        <Fact k='finished' v={when(s.finished_at)} />
      </Facts>
      {/* markdown: our own data, so no sanitizer — as with a task body */}
      {s.final_text && (
        <Final dangerouslySetInnerHTML={{ __html: snarkdown(s.final_text) }} />
      )}
      {s.error && <Fault mod='error'>{s.error}</Fault>}
      {s.stop_reason && <Fault>{s.stop_reason}</Fault>}
      <Log>
        {log.entries.map((x) => <Event key={x.seq} x={x} />)}
      </Log>
      {/* stderr: unordered diagnostics, never inside the log's seqs */}
      {log.stderr && <Err>{log.stderr}</Err>}
    </Frame>
  )
}

// A session in a list: the dot carries the status, the way a task row's
// does — plus what it's running. Its id chip links through to the view.
let Row = block('div', 'SessionRow', { Status: 'span', Model: 'span' })

export let SessionRow = ({ e }: { e: Ent }) => {
  let s = e.session!
  return (
    <Row>
      <Dot status={s.status ?? ''} />
      <Row.Status>{s.status ?? s.id}</Row.Status>
      {s.provider && <Row.Model>{s.provider} · {s.model}</Row.Model>}
      <View eid={e.eid} view='Id' />
    </Row>
  )
}
