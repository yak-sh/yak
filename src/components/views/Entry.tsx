// Session entries as a small renderer vocabulary. Summary and Full faces
// share this kit; component-specific registrations choose what each face says.
import { useState } from 'preact/hooks'
import { type Ent, friendly, kilo, type LogRow } from '../../types.ts'
import { backlinks, ent, repoUrl } from '../../live.ts'
import { block, el } from '../ui.tsx'
import { Entity } from '../Entity.tsx'
import { resolve } from '../registry.ts'
import { Icon } from '../icons.tsx'
import { Ansi } from '../Ansi.tsx'
import { Markdown } from '../Markdown.tsx'

let Frame = block('div', 'Entry', {
  Lens: 'div',
  Tabs: 'div',
  Line: 'span',
  More: 'button',
  Name: 'span',
  Status: 'span',
  Error: 'span',
  Code: 'pre',
  Output: 'div',
  Err: 'pre',
  Raw: 'span',
  Reason: 'div',
  Turn: 'div',
  Oops: 'div',
  Sys: 'div',
  SysTag: 'span',
  SysText: 'span',
  SysCount: 'span',
  Part: 'section',
  PartName: 'div',
})
let Instruction = block('details', 'Instruction', {
  Gist: 'summary',
  Body: 'div',
})
let {
  Lens,
  Tabs,
  Line,
  More,
  Name,
  Status,
  Error,
  Code,
  Output,
  Err,
  Raw,
  Reason,
  Turn,
  Oops,
  Sys,
  SysTag,
  SysText,
  SysCount,
  Part,
  PartName,
} = Frame
let Tab = el('button', 'Tab')

let lines = (text = '') => text.replace(/\n$/, '').split('\n')
let first = (text = '') => lines(text)[0]
let long = (text = '') => lines(text).length > 1
// The one control that grows a summary in place: `…` reveals the rest, `˅`
// folds it back. It appears only when there is more than the first line to show.
let more = (show: (() => void) | undefined, text: string, open = false) =>
  long(text) && (
    <More
      type='button'
      onClick={show}
      aria-label={open ? 'collapse entry' : 'show full entry'}
    >
      {open ? '˅' : '…'}
    </More>
  )
let body = (e: Ent) => e.content?.body ?? ''
let failed = (e: Ent) =>
  (e.exit?.code != null && e.exit.code != 0) || !!e.error || !!e.exception ||
  (e.response?.status != null && e.response.status >= 400)
let result = (e: Ent) => {
  let eid = backlinks(e.eid).find((x) => x.via == 'result.call')?.from
  return eid ? ent(eid) : undefined
}

export type EntryLine = {
  eid?: string
  call?: string
  result?: string
  seq: number
  line: string
  row?: LogRow
  n?: number
}

let settled = (row: LogRow | undefined, out: Ent): LogRow | undefined => {
  if (row?.kind == 'tool') return { ...row, ok: !failed(out) }
  if (row?.kind == 'exec') {
    let code = out.exit?.code
    return code == null
      ? { ...row, status: failed(out) ? '✗ failed' : '✓ done' }
      : { ...row, exit: code }
  }
  return row
}

// A result completes an earlier call; transcript order stays on that call so
// parallel tools settle in place rather than adding a second narration row.
// Both durable entities remain named on the merged line for its lens.
export let mergeTools = (entries: EntryLine[]) => {
  let calls = new Set(entries.flatMap((x) => x.eid && !x.call ? [x.eid] : []))
  let results = new Map<string, EntryLine>()
  for (let x of entries) {
    if (x.call && calls.has(x.call)) results.set(x.call, x)
  }
  return entries.flatMap((x) => {
    if (x.call && calls.has(x.call)) return []
    let out = x.eid ? results.get(x.eid) : undefined
    return out?.eid
      ? [{ ...x, result: out.eid, row: settled(x.row, ent(out.eid)) }]
      : [x]
  })
}

let span = (ms: number) => {
  let s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

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

let bare = (line: string) => {
  try {
    return String((JSON.parse(line) as { type?: unknown }).type ?? '?')
  } catch {
    return null
  }
}

export let entryVisible = (x: EntryLine) => !!x.row || !bare(x.line)

export let ToolSummary = ({
  name,
  detail,
  status,
  error,
  failed,
}: {
  name: string
  detail?: string
  status?: string | null
  error?: string
  failed?: boolean
}) => {
  let state = failed ? 'fail' : status?.startsWith('✓') ? 'success' : 'pending'
  return (
    <Frame mod={state}>
      <Name>{name}</Name>
      {detail && <Line>{detail}</Line>}
      {status && <Status>{status}</Status>}
      {error && <Error>{error}</Error>}
    </Frame>
  )
}

// Process logs and graph entries meet at this normalized face. The Session
// owns ordering and inspection; an individual transcript item belongs here.
export let EntryBody = ({ x, repo }: { x: EntryLine; repo?: string }) => {
  let r = x.row
  if (!r) {
    return bare(x.line) ? null : (
      <Raw>
        <Ansi text={x.line} />
      </Raw>
    )
  }
  switch (r.kind) {
    case 'say':
      return (
        <Frame mod={r.role}>
          <Markdown text={r.text} repo={repo} />
        </Frame>
      )
    case 'reason':
      return (
        <Reason>
          <Ansi text={r.text} />
        </Reason>
      )
    case 'tool':
      return (
        <ToolSummary
          name={r.name}
          detail={r.detail}
          status={r.ok == null ? '… pending' : r.ok ? '✓ done' : '✗ failed'}
          error={r.error}
          failed={r.ok === false}
        />
      )
    case 'exec': {
      let fail = r.exit != null
        ? r.exit != 0
        : r.status == 'failed' || r.status?.startsWith('✗')
      let status = r.exit != null
        ? `${fail ? '✗' : '✓'} exit ${r.exit}`
        : r.status ?? '… pending'
      return (
        <Frame
          mod={fail ? 'fail' : status.startsWith('✓') ? 'success' : 'pending'}
        >
          <Name>$</Name>
          <Line mod='command'>{first(r.command)}</Line>
          {r.desc && r.desc != 'Command' && <Line>{r.desc}</Line>}
          {status && <Status>{status}</Status>}
        </Frame>
      )
    }
    case 'turn':
      return (
        <Turn>
          {[
            r.model && friendly(r.model),
            r.ms != null && span(r.ms),
            usage(r.usage),
          ].filter(Boolean).join(' · ')}
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

export let EntrySummary = ({ e }: { e: Ent }) => (
  <Frame mod='meta'>
    {Object.keys(e).filter((k) =>
      e[k as keyof Ent] &&
      !['eid', 'num', 'kind', 'refs', 'kids', 'entry'].includes(k)
    ).join(' · ')}
  </Frame>
)

// Open in place: the `$ command` line stays exactly where the summary drew it,
// so the eye keeps its anchor; the truncated preview simply grows into the full
// command (wrapping) and the full output as a block below — no second card, no
// jump. Closed, it is the compact one-line summary as before.
export let CommandSummary = (
  { e, open, onOpen }: { e: Ent; open?: boolean; onOpen?: () => void },
) => {
  let out = result(e)
  let cmd = e.bash?.command ?? ''
  let text = body(out ?? e) || out?.stderr?.text || ''
  let state = out ? failed(out) ? 'fail' : 'success' : 'pending'
  return (
    <Frame mod={[state, open && 'open']}>
      <Name>$</Name> <Line mod='command'>{open ? cmd : first(cmd)}</Line>
      {text && !open && <Line>{first(text)}</Line>}
      <Status>
        {out ? failed(out) ? '✗ failed' : '✓ done' : '… pending'}
      </Status>
      {more(onOpen, [cmd, text].filter(Boolean).join('\n'), open)}
      {open && text && (
        <Output>
          <Ansi text={text} />
        </Output>
      )}
    </Frame>
  )
}

export let ResultSummary = (
  { e, open, onOpen }: { e: Ent; open?: boolean; onOpen?: () => void },
) => {
  let text = body(e)
  let err = e.stderr?.text
  return (
    <Frame mod={[failed(e) && 'fail', open && 'open']}>
      <Status>{e.exit?.code == null ? '↳' : `↳ exit ${e.exit.code}`}</Status>
      {!open && (text || err) && <Line>{first(text || err)}</Line>}
      {more(onOpen, [text, err].filter(Boolean).join('\n'), open)}
      {open && text && (
        <Output>
          <Ansi text={text} />
        </Output>
      )}
      {open && err && (
        <Err mod={failed(e) && 'fail'}>
          <Ansi text={err} />
        </Err>
      )}
    </Frame>
  )
}

export let MessageSummary = ({ e }: { e: Ent }) => (
  <Frame mod={e.message?.role}>
    <Markdown text={body(e)} repo={repoUrl(e)} />
  </Frame>
)

export let InstructionSummary = ({ e }: { e: Ent }) => {
  let n = lines(body(e)).length
  return (
    <Instruction>
      <Instruction.Gist>
        persona · {n} {n == 1 ? 'line' : 'lines'}
      </Instruction.Gist>
      <Instruction.Body>
        <MessageSummary e={e} />
      </Instruction.Body>
    </Instruction>
  )
}

export let CommandFull = ({ e }: { e: Ent }) => {
  return (
    <Frame>
      <Name>command</Name>
      <Code>
        $ <Ansi text={e.bash?.command ?? ''} />
      </Code>
    </Frame>
  )
}

export let ResultFull = ({ e }: { e: Ent }) => (
  <Frame mod={failed(e) && 'fail'}>
    {e.exit?.code != null && <Status>exit {e.exit.code}</Status>}
    {body(e) && (
      <Output>
        <Ansi text={body(e)} />
      </Output>
    )}
    {e.stderr?.text && (
      <Err mod={failed(e) && 'fail'}>
        <Ansi text={e.stderr.text} />
      </Err>
    )}
  </Frame>
)

export let MessageFull = ({ e }: { e: Ent }) => (
  <Frame mod={e.message?.role}>
    <Markdown text={body(e)} repo={repoUrl(e)} />
  </Frame>
)

let icon = (view: string) =>
  view == 'Full'
    ? 'file-text'
    : view == 'Markdown'
    ? 'hash'
    : view == 'JSON'
    ? 'braces'
    : 'bug'

// Entry rows are not cards, but expansion has the same view choice at its
// top-right edge. Qualifying the ask keeps this lens in the entry vocabulary.
export let EntryLens = ({ eid }: { eid: string }) => {
  let e = ent(eid)
  let out = e.call ? result(e) : undefined
  let call = e.result ? ent(e.result.call) : undefined
  let pair = call ? [call, e] : out ? [e, out] : [e]
  let full = resolve(e, 'Entry.Full').view != 'JSON'
  let markdown = resolve(e, 'Entry.Markdown').view != 'JSON'
  let views = [full && 'Full', markdown && 'Markdown', 'JSON', 'Debug']
    .filter(Boolean) as string[]
  let [view, setView] = useState(views[0])
  return (
    <Lens>
      <Tabs>
        {views.map((v) => (
          <Tab
            type='button'
            key={v}
            mod={v == view && 'on'}
            aria-label={v == 'Markdown' ? 'MD' : v}
            data-tip={v == 'Markdown' ? 'MD' : v}
            onClick={() => setView(v)}
          >
            <Icon name={icon(v)} />
          </Tab>
        ))}
      </Tabs>
      {pair.map((item) => (
        <Part key={item.eid}>
          {pair.length > 1 && (
            <PartName>{item.result ? 'result' : 'call'}</PartName>
          )}
          <Entity eid={item.eid} view={`Entry.${view}`} />
        </Part>
      ))}
    </Lens>
  )
}
