/** Authorization input is private component memory, deliberately outside draft/graph persistence. */
import { h } from 'preact'
import { useLayoutEffect, useMemo } from 'preact/hooks'
import { signal } from '@preact/signals'
import type { Frontend } from './frontend.ts'
import type { UIAgent } from './panels.ts'
import type { Comp } from '@yaks/graph'
import { useKeymap } from '@yaks/tui'

export const MCPAuthPanel = (
  { ui, agent }: { ui: Frontend; agent: UIAgent },
) => {
  // Application mode/progress belongs to the private frontend graph. Sensitive
  // URL/code/state material and async projection results never enter that graph.
  const privateState = useMemo(
    () =>
      signal({
        servers: [] as string[],
        url: '',
        redirect: '',
        input: '',
        generation: 0,
      }),
    [],
  )
  type State = typeof privateState.value & {
    open: boolean
    index: number
    busy: boolean
    feedback: string
  }
  const state = {
    get value(): State {
      const keyboard = ui.keyboard.value[0]?.keyboard as Comp | undefined
      return {
        ...privateState.value,
        open: Boolean(keyboard?.mcpAuth),
        index: Number(keyboard?.mcpAuthIndex ?? 0),
        busy: Boolean(keyboard?.mcpAuthBusy),
        feedback: String(keyboard?.mcpAuthFeedback ?? ''),
      }
    },
  }
  const patch = (value: Partial<State>) => {
    const { open, index, busy, feedback, ...privateFields } = value
    privateState.value = { ...privateState.value, ...privateFields }
    if (
      open !== undefined || index !== undefined || busy !== undefined ||
      feedback !== undefined
    ) {
      ui.keys({
        ...(open !== undefined ? { mcpAuth: open } : {}),
        ...(index !== undefined ? { mcpAuthIndex: index } : {}),
        ...(busy !== undefined ? { mcpAuthBusy: busy } : {}),
        ...(feedback !== undefined ? { mcpAuthFeedback: feedback } : {}),
      })
    }
  }
  useLayoutEffect(() => () => {
    const s = state.value
    if (s.open && agent.authorizeMCP) {
      void agent.authorizeMCP('cancel', s.servers[s.index]).catch(() => {})
    }
    privateState.value = {
      servers: [],
      url: '',
      redirect: '',
      input: '',
      generation: privateState.value.generation + 1,
    }
  }, [])
  const run = (action: 'list' | 'begin' | 'complete', callback = '') => {
    const current = state.value
    const generation = current.generation
    patch({
      busy: true,
      input: '',
      feedback: action === 'begin' ? 'Preparing authorization…' : 'Connecting…',
    })
    void agent.authorizeMCP!(action, current.servers[current.index], callback)
      .then((reply) => {
        if (!state.value.open || state.value.generation !== generation) return
        patch({
          busy: false,
          ...(reply.servers ? { servers: reply.servers, index: 0 } : {}),
          url: reply.url ?? '',
          redirect: reply.redirectUrl ?? '',
          feedback: reply.message ??
            (reply.url
              ? 'Open the link. After authorizing, copy the entire return URL and paste it here.'
              : 'Select a server and press Enter.'),
        })
      }, (error: unknown) => {
        if (state.value.open && state.value.generation === generation) {
          patch({
            busy: false,
            feedback: error instanceof Error
              ? error.message
              : 'Authorization failed. Begin again.',
          })
        }
      })
  }
  useKeymap((key) => {
    const s = state.value
    if (!s.open) {
      const mode = (ui.client.ent('keyboard')?.keyboard as Comp)?.mode
      if (
        mode !== 'NORMAL' || key.text !== 'A' || key.ctrl || key.alt ||
        !agent.authorizeMCP
      ) return false
      patch({ open: true, generation: s.generation + 1 })
      run('list')
      return true
    }
    if (key.ctrl && key.text === 'c') return false
    if (key.name === 'escape') {
      patch({ open: false, url: '', input: '', generation: s.generation + 1 })
      void agent.authorizeMCP!('cancel', s.servers[s.index]).catch(() => {})
      return true
    }
    if (s.busy) return true
    if (!s.url) {
      if (key.text === 'j' || key.name === 'down') {
        patch({ index: Math.min(s.servers.length - 1, s.index + 1) })
      }
      if (key.text === 'k' || key.name === 'up') {
        patch({ index: Math.max(0, s.index - 1) })
      }
      if (key.name === 'enter' && s.servers.length) run('begin')
    } else if (key.name === 'enter') {
      if (s.input) run('complete', s.input)
    } else if (key.name === 'backspace') patch({ input: s.input.slice(0, -1) })
    else if (
      (key.name === 'paste' || key.name === 'char') && key.text && !key.ctrl &&
      !key.alt
    ) {
      if (s.input.length + key.text.length <= 16384) {
        patch({ input: s.input + key.text.replace(/[\r\n]/g, '') })
      } else patch({ feedback: 'Return URL is too long.' })
    }
    return true
  })
  const s = state.value
  if (!s.open) return null
  return h(
    'div',
    { border: 'Composer_Border', col: '1' },
    h(
      'div',
      { class: 'Panel_Title' },
      'Authorization · j/k connection · Enter select/submit · Esc cancel',
    ),
    ...s.servers.map((name, i) =>
      h('div', { class: i === s.index ? 'Session_Selected' : '' }, name)
    ),
    !s.servers.length
      ? h('div', null, 'No authorizable connections configured.')
      : null,
    s.url ? h('div', { wrap: '1' }, h('a', { href: s.url }, s.url)) : null,
    s.redirect
      ? h(
        'div',
        { wrap: '1' },
        'Return address: ' + s.redirect +
          ' (a browser connection error here is okay; copy its address bar)',
      )
      : null,
    s.url
      ? h(
        'div',
        null,
        s.input
          ? 'Return URL received · Enter to submit'
          : 'Paste return URL here (hidden)',
      )
      : null,
    h('div', { wrap: '1' }, s.feedback),
  )
}
