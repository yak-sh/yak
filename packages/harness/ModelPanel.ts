/** Graph-backed selection; provider identity is resolved by the backend. */
import { h } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import type { Bundle, Comp } from '@yaks/graph'
import { Scroll, useKeymap } from '@yaks/tui'
import type { Frontend } from './frontend.ts'
import type { UIAgent } from './panels.ts'

export const ModelPanel = ({ ui, agent, session }: {
  ui: Frontend
  agent: UIAgent
  session?: string
}) => {
  const keyboard = ui.keyboard.value[0].keyboard as Comp
  const open = Boolean(keyboard.models)
  const state = ui.view.value[0].frontend as Comp
  const choices = JSON.parse(String(state.modelChoices ?? '[]')) as Bundle[]
  const current = session
    ? state.currentModel
    : state.newModel ?? state.currentModel
  const label = (b: Bundle) =>
    String((b.model as Comp).name) + ' · ' + String((b.provider as Comp).name)
  useLayoutEffect(() => {
    if (!agent.models) return
    let alive = true
    const load = async () => {
      try {
        const result = await agent.models!(session)
        if (alive) {
          ui.patch({
            modelChoices: JSON.stringify(result.choices),
            currentModel: result.current ?? '',
          })
        }
      } catch (error) {
        if (alive && open) ui.keys({ modelFeedback: String(error) })
      }
    }
    void load()
    // A picker refreshes on opening/selection, not on every streamed token.
    return () => {
      alive = false
    }
  }, [agent, session, open, ui])
  const choose = async (id: string) => {
    if ((ui.client.ent('keyboard')!.keyboard as Comp).modelBusy) return
    ui.keys({ modelBusy: true, modelFeedback: '' })
    try {
      if (session) await agent.selectModel!(session, id)
      else ui.patch({ newModel: id })
      const selected = (ui.client.ent('view')!.frontend as Comp).selected
      if ((selected ?? undefined) == session) {
        ui.patch({ currentModel: id })
        ui.keys({ models: false })
      }
    } catch (error) {
      ui.keys({ modelFeedback: String(error) })
    } finally {
      ui.keys({ modelBusy: false })
    }
  }
  useKeymap((key) => {
    const k = ui.client.ent('keyboard')!.keyboard as Comp
    if (!k.models) return false
    if (key.ctrl && key.text == 'c') return false
    if (key.name == 'escape' || key.text == 'm') {
      ui.keys({ models: false })
      return true
    }
    const index = Math.min(
      choices.length - 1,
      Math.max(0, Number(k.modelIndex ?? 0)),
    )
    if (key.name == 'down' || key.text == 'j') {
      ui.keys({ modelIndex: Math.min(choices.length - 1, index + 1) })
    }
    if (key.name == 'up' || key.text == 'k') {
      ui.keys({ modelIndex: Math.max(0, index - 1) })
    }
    if (key.name == 'enter' && choices[index]) {
      void choose(choices[index].entity.eid)
    }
    return true
  })
  const active = choices.find((b) => b.entity.eid == current)
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'Entry_Hint' },
      active ? 'Model (next): ' + label(active) : 'Model: default',
    ),
    open
      ? h(
        'div',
        { border: 'Composer_Border', height: '9', col: '1' },
        h(
          'div',
          { class: 'Panel_Title' },
          'Model · j/k select · Enter choose · Esc cancel',
        ),
        h(
          'div',
          { class: 'Muted' },
          session
            ? 'Next request only; running requests stay unchanged. Sign in with A.'
            : 'Applies to the next new session. Authorize providers with A.',
        ),
        h(
          Scroll,
          {
            id: 'models',
            grow: '1',
            keyboard: false,
            reveal: Number(keyboard.modelIndex ?? 0),
          },
          ...choices.map((b, i) =>
            h('div', {
              key: b.entity.eid,
              fill: '1',
              class: i == Number(keyboard.modelIndex ?? 0)
                ? 'Session_Selected'
                : '',
              onClick: () => {
                void choose(b.entity.eid)
              },
            }, (b.entity.eid == current ? '● ' : '○ ') + label(b))
          ),
          !choices.length ? h('div', null, 'No configured models.') : null,
        ),
        h('div', { wrap: '1' }, String(keyboard.modelFeedback ?? '')),
      )
      : null,
  )
}
