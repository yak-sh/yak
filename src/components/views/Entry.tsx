// Session entries as a small renderer vocabulary. Summary and Full faces
// share this kit; component-specific registrations choose what each face says.
import { useState } from 'preact/hooks'
import { type Ent } from '../../types.ts'
import { backlinks, ent } from '../../live.ts'
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
  Code: 'pre',
  Output: 'div',
  Err: 'pre',
})
let { Lens, Tabs, Line, More, Name, Status, Code, Output, Err } = Frame
let Tab = el('button', 'Tab')

let lines = (text = '') => text.replace(/\n$/, '').split('\n')
let first = (text = '') => lines(text)[0]
let long = (text = '') => lines(text).length > 1
let more = (show: (() => void) | undefined, text: string) =>
  long(text) && (
    <More type='button' onClick={show} aria-label='show full entry'>…</More>
  )
let body = (e: Ent) => e.content?.body ?? ''
let failed = (e: Ent) => e.exit?.code != null && e.exit.code != 0
let result = (e: Ent) => {
  let eid = backlinks(e.eid).find((x) => x.via == 'result.call')?.from
  return eid ? ent(eid) : undefined
}

export let EntrySummary = ({ e }: { e: Ent }) => (
  <Frame mod='meta'>
    {Object.keys(e).filter((k) =>
      e[k as keyof Ent] &&
      !['eid', 'num', 'kind', 'refs', 'kids', 'entry'].includes(k)
    ).join(' · ')}
  </Frame>
)

export let CommandSummary = (
  { e, onOpen }: { e: Ent; onOpen?: () => void },
) => {
  let out = result(e)
  let text = body(out ?? e) || out?.stderr?.text || ''
  return (
    <Frame mod={out && failed(out) && 'fail'}>
      <Name>$</Name> <Line mod='command'>{first(e.bash?.command)}</Line>
      {text && <Line>{first(text)}</Line>}
      {more(
        onOpen,
        [e.bash?.command, body(out ?? e), out?.stderr?.text]
          .filter(Boolean).join('\n'),
      )}
    </Frame>
  )
}

export let ResultSummary = (
  { e, onOpen }: { e: Ent; onOpen?: () => void },
) => (
  <Frame mod={failed(e) && 'fail'}>
    <Status>{e.exit?.code == null ? '↳' : `↳ exit ${e.exit.code}`}</Status>
    {(body(e) || e.stderr?.text) && (
      <Line>{first(body(e) || e.stderr?.text)}</Line>
    )}
    {more(onOpen, [body(e), e.stderr?.text].filter(Boolean).join('\n'))}
  </Frame>
)

export let MessageSummary = ({ e }: { e: Ent }) => (
  <Frame mod={e.message?.role}>
    <Markdown text={body(e)} />
  </Frame>
)

export let CommandFull = ({ e }: { e: Ent }) => {
  let out = result(e)
  return (
    <Frame mod={out && failed(out) && 'fail'}>
      <Name>command</Name>
      <Code>
        $ <Ansi text={e.bash?.command ?? ''} />
      </Code>
      {out?.exit?.code != null && <Status>exit {out.exit.code}</Status>}
      {body(out ?? e) && (
        <Output>
          <Ansi text={body(out ?? e)} />
        </Output>
      )}
      {out?.stderr?.text && (
        <Err mod={failed(out) && 'fail'}>
          <Ansi text={out.stderr.text} />
        </Err>
      )}
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
    <Markdown text={body(e)} />
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
      <Entity eid={eid} view={`Entry.${view}`} />
    </Lens>
  )
}
