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

export const shortcuts = [
  ['i', 'INSERT: edit the draft'],
  ['j / k', 'transcript down / up; sidebar next / previous sibling'],
  ['h / l', 'transcript previous / next page; sidebar parent / child'],
  ['gg / G', 'transcript start / end (follow)'],
  ['Tab', 'switch transcript / sidebar focus'],
  ['v', 'VISUAL source selection; hjkl move, y copy, Esc NORMAL'],
  ['n / p', 'next / previous root session'],
  ['o', 'new session'],
  ['t', 'toggle message / task'],
  ['a / z / s', 'archive root / show archived / show settled'],
  ['? / Esc', 'show / dismiss help'],
  ['Ctrl+U', 'cut entire draft: copy then clear (all modes)'],
  ['Ctrl+C', 'quit'],
] as const

export let Keyboard = ({ ui, action }: {
  ui: Frontend
  action: (key: Key) => boolean | void
}) => {
  let state = ui.keyboard.value[0].keyboard as Comp
  useKeymap((key) => {
    if (key.ctrl && key.text == 'c') return false
    if (key.ctrl && key.text == 'u') {
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
    let current = () => ui.client.ent('keyboard')!.keyboard as Comp
    let s = current()
    let visual = ui.client.ent('visual')!.visual as VisualState
    if (s.mode == 'VISUAL' || visual.surface) {
      visualKey(key)
      if (!((ui.client.ent('visual')!.visual as VisualState).surface)) {
        ui.keys({ mode: 'NORMAL', pending: '' })
      }
      return true
    }
    if (key.name == 'escape') {
      ui.keys({ mode: 'NORMAL', help: false, pending: '' })
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
          visualKey({ ...key, text })
          if (!(ui.client.ent('visual')!.visual as VisualState).surface) {
            ui.keys({ mode: 'NORMAL' })
          }
        } else command({ ...key, text })
      }
      return true
    }
    return command(key)
    function command(k: Key): boolean {
      s = current()
      let text = k.name == 'char' && !k.alt && !k.ctrl ? k.text : undefined
      if (s.help) {
        if (text == '?' || k.name == 'escape') ui.keys({ help: false })
        return true
      }
      if (text == '?') {
        ui.keys({ help: true, pending: '' })
        return true
      }
      if (text == 'i') {
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
      if (text == 'v') {
        if (beginVisual(id)) {
          ui.keys({ mode: 'VISUAL', focus: 'transcript', pending: '' })
        }
        return true
      }
      if (text == 'g' && s.pending != 'g') {
        ui.keys({ pending: 'g' })
        return true
      }
      ui.keys({ pending: '' })
      if (text == 'G' || text == 'g' && s.pending == 'g') {
        pressTo(id, { name: text == 'G' ? 'end' : 'home', ctrl: true })
        return true
      }
      let direction = text ??
        ({ up: 'k', down: 'j', left: 'h', right: 'l' } as Record<
          string,
          string
        >)[k.name]
      if (['h', 'j', 'k', 'l'].includes(direction ?? '')) {
        if (s.focus == 'sidebar') {
          action({ name: 'char', text: direction, ctrl: true })
        } else {pressTo(id, {
            name: ({ h: 'pageup', j: 'down', k: 'up', l: 'pagedown' } as Record<
              string,
              Key['name']
            >)[direction!],
          })}
        return true
      }
      let mapped: Record<string, Key> = {
        n: { name: 'char', text: 'n', ctrl: true },
        p: { name: 'char', text: 'p', ctrl: true },
        o: { name: 'char', text: 'o', ctrl: true },
        t: { name: 'tab' },
        a: { name: 'char', text: 'a', alt: true },
        z: { name: 'char', text: 'z', alt: true },
        s: { name: 'char', text: 's', ctrl: true },
      }
      if (text && mapped[text]) action(mapped[text])
      else if (k.ctrl && k.name == 'end') pressTo(id, k)
      else if (k.name == 'pageup' || k.name == 'pagedown') pressTo(id, k)
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
