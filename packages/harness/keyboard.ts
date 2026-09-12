/** Harness modes are graph state; the key interceptor and text surfaces are not. */
import { h } from 'preact'
import type { Comp } from '@yaks/graph'
import {
  beginVisual,
  copyText,
  type Key,
  pressFocused,
  pressTo,
  useKeymap,
  visualKey,
  type VisualState,
} from '@yaks/tui'
import type { Frontend } from './frontend.ts'

// NORMAL bindings own both routing and help; aliases share one definition.
type Binding = {
  keys: string[]
  help: string
  focus?: 'transcript' | 'sidebar'
  transcript?: Key
  sidebar?: Key
  action?: Key
}
const ctrl = (text: string): Key => ({ name: 'char', text, ctrl: true })
const bindings: Binding[] = [
  { keys: ['h', 'left'], help: 'cursor left', transcript: { name: 'left' } },
  { keys: ['l', 'right'], help: 'cursor right', transcript: { name: 'right' } },
  {
    keys: ['j', 'down'],
    help: 'next entry / sidebar item',
    transcript: { name: 'down' },
    sidebar: ctrl('j'),
  },
  {
    keys: ['k', 'up'],
    help: 'previous entry / sidebar item',
    transcript: { name: 'up' },
    sidebar: ctrl('k'),
  },
  {
    keys: ['Ctrl+u'],
    help: 'half page up in focused pane',
    transcript: ctrl('u'),
    sidebar: ctrl('u'),
  },
  {
    keys: ['Ctrl+d'],
    help: 'half page down in focused pane',
    transcript: ctrl('d'),
    sidebar: ctrl('d'),
  },
  {
    keys: ['gg', 'Ctrl+home'],
    help: 'focused pane start',
    transcript: { name: 'home', ctrl: true },
    sidebar: { name: 'home', ctrl: true },
  },
  {
    keys: ['G', 'Ctrl+end'],
    help: 'focused pane end',
    transcript: { name: 'end', ctrl: true },
    sidebar: { name: 'end', ctrl: true },
  },
  {
    keys: ['Ctrl+b', 'pageup'],
    help: 'transcript previous page',
    transcript: { name: 'pageup' },
  },
  {
    keys: ['Ctrl+f', 'pagedown'],
    help: 'transcript next page',
    transcript: { name: 'pagedown' },
  },
  {
    keys: ['n'],
    help: 'next / previous root session: n / p',
    action: ctrl('n'),
  },
  { keys: ['p'], help: 'previous root session', action: ctrl('p') },
  { keys: ['o'], help: 'new session', action: ctrl('o') },
  { keys: ['t'], help: 'toggle message / task', action: { name: 'tab' } },
  {
    keys: ['a'],
    help: 'archive selected session',
    action: { name: 'char', text: 'a', alt: true },
  },
  {
    keys: ['z'],
    help: 'show archived',
    action: { name: 'char', text: 'z', alt: true },
  },
  { keys: ['s'], help: 'show settled', action: ctrl('s') },
]
export const shortcuts = [
  ['i', 'INSERT: edit the draft'],
  ...bindings.map(({ keys, help }) => [keys[0], help]),
  ['Ctrl+w h/l', 'focus transcript / sidebar (Tab toggles)'],
  ['v', 'VISUAL rendered selection; hjkl move, y copy, Esc NORMAL'],
  ['Enter', 'inspect selected entry source; [/] chunks; Esc returns'],
  ['? / Esc', 'show / dismiss help'],
  ['r', 'runtime panel: j/k select, x interrupt/cancel queued, c continue'],
  ['Ctrl+U', 'INSERT / VISUAL: cut entire draft'],
  ['Alt+p', 'insert saved local yank into draft'],
  ['Ctrl+C', 'quit'],
]

export let Keyboard = ({ ui, action }: {
  ui: Frontend
  action: (key: Key) => boolean | void
}) => {
  let state = ui.keyboard.value[0].keyboard as Comp
  useKeymap((key) => {
    let current = () => ui.client.ent('keyboard')!.keyboard as Comp
    if (key.ctrl && key.text == 'c') return false
    if (
      key.ctrl && key.text == 'u' &&
      (current().mode == 'INSERT' ||
        Boolean((ui.client.ent('visual')!.visual as VisualState).surface))
    ) {
      let text = String((ui.client.ent('draft')!.draft as Comp).text ?? '')
      if (!text) return true
      let visual = ui.client.ent('visual')!.visual as VisualState
      ui.select({ ...visual, yank: text })
      // Persist the recovery copy before requesting the clipboard or clearing input.
      try {
        let copied = copyText(text)
        ui.edit({ text: '', at: 0 })
        ui.keys({
          clipboard: copied
            ? 'Draft cut; clipboard copy requested; local yank saved'
            : 'Draft cut to local yank; clipboard unavailable',
        })
      } catch {
        ui.keys({
          clipboard: 'Clipboard write failed; draft retained; local yank saved',
        })
      }
      return true
    }
    if (key.alt && key.text == 'p') {
      const yank = String(
        (ui.client.ent('visual')!.visual as VisualState).yank ?? '',
      )
      const draft = ui.client.ent('draft')!.draft as Comp
      const text = String(draft.text ?? ''), at = Number(draft.at ?? 0)
      if (yank) {
        ui.edit({
          text: text.slice(0, at) + yank + text.slice(at),
          at: at + yank.length,
        })
      }
      ui.keys({
        clipboard: yank ? 'Local yank inserted' : 'Local yank is empty',
      })
      return true
    }
    let s = current()
    let visual = ui.client.ent('visual')!.visual as VisualState
    if (visual.surface) {
      visualKey(key)
      if (!((ui.client.ent('visual')!.visual as VisualState).surface)) {
        ui.keys({ mode: 'NORMAL', pending: '' })
      }
      return true
    }
    if (s.detail) {
      if (key.name == 'escape' || key.text == 'q') {
        ui.keys({ detail: false, detailText: '', detailError: '' })
      } else if (key.text == ']' && s.detailNext != null) {
        ui.keys({ detailStart: Number(s.detailNext) })
      } else if (key.text == '[') {
        ui.keys({ detailStart: Math.max(0, Number(s.detailStart ?? 0) - 4096) })
      } else {pressTo(
          'entry-detail',
          key.text == 'j'
            ? { name: 'down' }
            : key.text == 'k'
            ? { name: 'up' }
            : key,
        )}
      return true
    }
    if (key.name == 'escape') {
      const session = (ui.client.ent('view')!.frontend as Comp).selected ??
        'new'
      pressTo('transcript-' + session, key)
      ui.keys({
        mode: 'NORMAL',
        ...(s.mode == 'INSERT' ? { focus: 'transcript' } : {}),
        help: false,
        runtime: false,
        pending: '',
      })
      return true
    }
    if (s.mode == 'INSERT') {
      // Preserve the previous explicit selection shortcut.
      if (key.alt && key.text == 'v') {
        beginVisual('input')
        if ((ui.client.ent('visual')!.visual as VisualState).surface) {
          ui.keys({ mode: 'VISUAL' })
        }
        return true
      }
      return false
    }
    if (
      key.name == 'char' && !key.ctrl && !key.alt && (key.text?.length ?? 0) > 1
    ) {
      // Decoder batches printable bytes. Stop splitting when a command enters INSERT.
      for (let text of key.text!) {
        if (current().mode == 'INSERT') pressFocused({ ...key, text })
        else if (current().mode == 'VISUAL') {
          command({ ...key, text })
        } else command({ ...key, text })
      }
      return true
    }
    return command(key)
    function command(k: Key): boolean {
      s = current()
      let text = k.name == 'char' && !k.alt && !k.ctrl ? k.text : undefined
      if (k.ctrl && k.text == 'w') {
        ui.keys({ pending: 'window' })
        return true
      }
      if (s.pending == 'window') {
        ui.keys({
          pending: '',
          ...(text == 'h'
            ? { focus: 'transcript' }
            : text == 'l'
            ? { focus: 'sidebar' }
            : {}),
        })
        return true
      }
      if (text == 'r') {
        ui.keys({ runtime: !s.runtime })
        return true
      }
      if (s.runtime) return false
      if (s.help) {
        if (text == '?' || k.name == 'escape') ui.keys({ help: false })
        return true
      }
      if (text == '?') {
        ui.keys({ help: true, pending: '' })
        return true
      }
      if (text == 'i') {
        const selectedSession =
          (ui.client.ent('view')!.frontend as Comp).selected ?? 'new'
        pressTo('transcript-' + selectedSession, { name: 'escape' })
        ui.keys({ mode: 'INSERT', pending: '' })
        return true
      }
      if (k.name == 'tab') {
        ui.keys({
          focus: s.focus == 'transcript' ? 'sidebar' : 'transcript',
          pending: '',
        })
        return true
      }
      let id = 'transcript-' +
        String((ui.client.ent('view')!.frontend as Comp).selected ?? 'new')
      if (k.name == 'enter' && s.focus == 'transcript') {
        ui.keys({
          detail: true,
          detailStart: 0,
          detailText: '',
          detailError: '',
          detailRevision: '',
          detailNext: null,
        })
        return true
      }
      if (text == 'v') {
        if (!pressTo(id, { name: 'char', text: 'v' }) && beginVisual(id)) {
          ui.keys({ mode: 'VISUAL', focus: 'transcript', pending: '' })
        }
        return true
      }
      if (text == 'y' && s.mode == 'VISUAL') {
        pressTo(id, k)
        return true
      }
      if (text == 'g' && s.pending != 'g') {
        ui.keys({ pending: 'g' })
        return true
      }
      ui.keys({ pending: '' })
      let chord = text == 'g' && s.pending == 'g'
        ? 'gg'
        : !k.alt
        ? (k.ctrl ? 'Ctrl+' : '') + (k.name == 'char' ? k.text : k.name)
        : ''
      let binding = bindings.find((binding) => binding.keys.includes(chord))
      if (binding?.focus) ui.keys({ focus: binding.focus })
      else if (binding?.action) action(binding.action)
      else if (binding) {
        if (s.focus == 'sidebar') {
          if (binding.sidebar) action(binding.sidebar)
        } else if (binding.transcript) pressTo(id, binding.transcript)
      }
      return true
    }
  })
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'Entry_Hint' },
      String(state.mode) +
        (state.mode == 'NORMAL'
          ? ' · ' + state.focus + ' · ? help'
          : ' · Esc NORMAL'),
    ),
    state.clipboard
      ? h('div', { class: 'Entry_Hint' }, String(state.clipboard))
      : null,
    state.help
      ? h(
        'div',
        { border: 'Composer_Border' },
        ...shortcuts.map(([key, description]) =>
          h('div', { wrap: '1', key }, key.padEnd(12) + description)
        ),
      )
      : null,
  )
}
