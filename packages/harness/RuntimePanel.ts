/** Optional runtime view. Application selection and feedback remain graph state. */
import { h } from 'preact'
import { useLayoutEffect, useMemo } from 'preact/hooks'
import { signal } from '@preact/signals'
import { type Bundle, type Comp } from '@yaks/graph'
import { define, type Renderer } from '@yaks/render'
import { parse } from '@yaks/query'
import { render } from '@yaks/preact'
import { loadVocab } from '@yaks/vocab'
import { Scroll, useKeymap } from '@yaks/tui'
import type { RuntimeAction } from './runtime.ts'
import type { Frontend } from './frontend.ts'
import type { UIAgent } from './panels.ts'
import { sessionLine } from './panels.ts'

let vocabulary = loadVocab([{
  title: 'runtime projection',
  $defs: {
    session: { properties: { status: { type: 'string' } } },
    dispatch: { properties: { state: { type: 'string' } } },
    attempt: { properties: { state: { type: 'string' } } },
    call: { properties: {} },
    error: { properties: { code: { type: 'string' } } },
  },
}])
let label = (match: string, text: string, color: string): Renderer => ({
  view: 'Runtime',
  match: parse(match),
  render: (_b, host) => host('span', { class: color }, text),
})
export let runtimeViews = define([
  label('.session&.dispatch.state=queued', 'queued', 'Key'),
  label('.session&.attempt.state=inflight', 'generating', 'Key'),
  label('.session&.error.code=interrupted', 'interrupted', 'Muted'),
  label('.session.status=running&.call', 'waiting for tool', 'Key'),
  label('.session.status=running', 'running', 'Key'),
  label('.session.status=pending', 'pending', 'Key'),
  label('.session.status=failed', 'failed', 'Bad'),
  label('.session.status=stopped', 'stopped', 'Muted'),
  label('.session', 'idle', 'Good'),
])
export let elapsed = (start: unknown, now: number): string => {
  let at = typeof start == 'string' ? Date.parse(start) : NaN
  if (!Number.isFinite(at)) return ''
  let seconds = Math.max(0, Math.floor((now - at) / 1000))
  return seconds < 60
    ? seconds + 's'
    : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's'
}

export let RuntimePanel = ({ ui, agent, session, subscribe }: {
  ui: Frontend
  agent: UIAgent
  session?: string
  subscribe: (fn: () => void) => () => void
}) => {
  let state = ui.keyboard.value[0].keyboard as Comp
  let open = Boolean(state.runtime)
  // Async read result is a projection; timer is presentation, neither is domain state.
  let rows = useMemo(() => signal<Bundle[]>([]), [])
  let now = useMemo(() => signal(Date.now()), [])
  useLayoutEffect(() => {
    if (!open || !session || !agent.runtime) return
    let alive = true, busy = false, dirty = false
    rows.value = []
    let load = async () => {
      if (busy) {
        dirty = true
        return
      }
      busy = true
      try {
        let value = await agent.runtime!(session)
        if (alive) rows.value = value
      } catch (e) {
        if (alive) ui.keys({ runtimeFeedback: String(e) })
      } finally {
        busy = false
        if (dirty && alive) {
          dirty = false
          void load()
        }
      }
    }
    void load()
    let off = subscribe(() => void load())
    let timer = setInterval(() => now.value = Date.now(), 1000)
    return () => {
      alive = false
      off()
      clearInterval(timer)
    }
  }, [open, session, agent, subscribe, ui])
  useKeymap((key) => {
    let current = ui.client.ent('keyboard')!.keyboard as Comp
    if (!current.runtime || current.mode != 'NORMAL') return false
    if (key.ctrl && key.text == 'c') return false
    if (key.name == 'escape' || key.text == 'r') {
      ui.keys({ runtime: false })
      return true
    }
    let text = key.text
    let list = rows.value
    let index = Math.max(
      0,
      list.findIndex((b) => b.entity.eid == current.runtimeSelected),
    )
    let selected = list[index]
    if (text == 'j' || text == 'k') {
      let next = list[
        Math.max(0, Math.min(list.length - 1, index + (text == 'j' ? 1 : -1)))
      ]
      if (next) ui.keys({ runtimeSelected: next.entity.eid })
    } else if ((text == 'x' || text == 'c') && selected && agent.control) {
      let action: RuntimeAction = text == 'c'
        ? 'resume'
        : (selected.dispatch as Comp | undefined)?.state == 'queued'
        ? 'cancel-queued'
        : 'interrupt'
      ui.keys({ runtimeFeedback: 'Requesting ' + action + '…' })
      void agent.control(selected.entity.eid, action).then(
        (message) => ui.keys({ runtimeFeedback: message }),
        (error) => ui.keys({ runtimeFeedback: String(error) }),
      )
    }
    return true
  })
  if (!open) return null
  let index = Math.max(
    0,
    rows.value.findIndex((b) => b.entity.eid == state.runtimeSelected),
  )
  return h(
    'div',
    { border: 'Composer_Border', height: '10', col: '1' },
    h(
      'div',
      { class: 'Panel_Title' },
      'Runtime · j/k select · x interrupt/cancel queued · c continue · r close',
    ),
    h(
      Scroll,
      { id: 'runtime', grow: '1', keyboard: false, reveal: index },
      ...rows.value.map((b, i) =>
        h(
          'div',
          {
            key: b.entity.eid,
            fill: '1',
            class: i == index ? 'Session_Selected' : '',
          },
          render(runtimeViews, b, 'Runtime', vocabulary),
          ' ',
          elapsed(
            (b.updated as Comp | undefined)?.at ??
              (b.created as Comp | undefined)?.at,
            now.value,
          ),
          ' · ',
          sessionLine(b),
        )
      ),
    ),
    !session ? h('div', null, 'Select a session first.') : null,
    h(
      'div',
      { wrap: '1', class: 'Muted' },
      String(
        state.runtimeFeedback ??
          'Actions affect only the selected session, never independent processes or task completion.',
      ),
    ),
  )
}
