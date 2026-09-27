/** Choose the graph persona a new session opens with. */
import { h } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import type { Bundle, Comp } from '@yaks/graph'
import { Scroll, useKeymap } from '@yaks/tui'
import type { Frontend } from './frontend.ts'
import type { UIAgent } from './panels.ts'

let label = (b: Bundle): string =>
  String((b.doc as Comp | undefined)?.title || b.entity.eid)

export let PersonaPanel = ({ ui, agent, session }: {
  ui: Frontend
  agent: UIAgent
  session?: string
}) => {
  let keyboard = ui.keyboard.value[0].keyboard as Comp
  let open = Boolean(keyboard.personas) && !session
  let state = ui.view.value[0].frontend as Comp
  let choices = JSON.parse(String(state.personaChoices ?? '[]')) as Bundle[]
  let current = String(state.newPersona ?? '')
  useLayoutEffect(() => {
    if (session || !agent.personas) return
    let alive = true
    agent.personas().then((rows) => {
      if (alive) ui.patch({ personaChoices: JSON.stringify(rows) })
    }, (error) => {
      if (alive && open) ui.keys({ personaFeedback: String(error) })
    })
    return () => {
      alive = false
    }
  }, [agent, session, open, ui])
  useLayoutEffect(() => {
    if (session && keyboard.personas) ui.keys({ personas: false })
  }, [session, keyboard.personas, ui])
  let choose = (id: string | null) => {
    ui.patch({ newPersona: id })
    ui.keys({ personas: false, personaFeedback: '' })
  }
  useKeymap((key) => {
    if (!open) return false
    if (key.ctrl && key.text == 'c') return false
    if (key.name == 'escape' || key.text == 'P') {
      ui.keys({ personas: false })
      return true
    }
    let index = Math.min(
      choices.length,
      Math.max(0, Number(keyboard.personaIndex ?? 0)),
    )
    if (key.name == 'down' || key.text == 'j') {
      ui.keys({ personaIndex: Math.min(choices.length, index + 1) })
    }
    if (key.name == 'up' || key.text == 'k') {
      ui.keys({ personaIndex: Math.max(0, index - 1) })
    }
    if (key.name == 'enter') {
      choose(index ? choices[index - 1].entity.eid : null)
    }
    return true
  })
  if (session) return null
  let active = choices.find((b) => b.entity.eid == current)
  let index = Number(keyboard.personaIndex ?? 0)
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'Entry_Hint' },
      active ? 'Persona (next): ' + label(active) : 'Persona: checkout default',
    ),
    open
      ? h(
        'div',
        { border: 'Composer_Border', height: '9', col: '1' },
        h(
          'div',
          { class: 'Panel_Title' },
          'Persona · j/k select · Enter choose · Esc cancel',
        ),
        h('div', { class: 'Muted' }, 'Applies to the next new session.'),
        h(
          Scroll,
          {
            id: 'personas',
            grow: '1',
            keyboard: false,
            reveal: index,
          },
          h('div', {
            fill: '1',
            class: index == 0 ? 'Session_Selected' : '',
            onClick: () => choose(null),
          }, (current ? '○ ' : '● ') + 'Checkout default'),
          ...choices.map((b, i) =>
            h('div', {
              key: b.entity.eid,
              fill: '1',
              class: index == i + 1 ? 'Session_Selected' : '',
              onClick: () => choose(b.entity.eid),
            }, (current == b.entity.eid ? '● ' : '○ ') + label(b))
          ),
        ),
        h('div', { wrap: '1' }, String(keyboard.personaFeedback ?? '')),
      )
      : null,
  )
}
