/** Keyboard focus and native form events for any tree painted by the
 * terminal: what a browser does for its controls by itself. Tab walks them,
 * Enter and Space press one, a field takes what is typed, Escape lets go, and
 * every key is a keydown on the element in focus first, so a page's own
 * listeners (vim's keys, @yaks/ux/keys) hear it as they would in a browser.
 * The app owns links and history; this adapter knows only DOM controls. */
import { dispatch, doc, onNavigate, type TElement } from './dom.ts'
import { edit } from './Textarea.ts'
import type { Key } from './input.ts'

let names: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  home: 'Home',
  end: 'End',
  delete: 'Delete',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}
export let event = (
  node: TElement,
  type: string,
  props: Record<string, unknown> = {},
): Event => {
  let e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, props)
  dispatch(node, e)
  return e
}

// Controls that take text keep every printable key; any other control (a
// select, a checkbox, a button) leaves them to the page.
let entering = (node: TElement | null): boolean =>
  !!node && (
    node.matches('textarea') || node.isContentEditable ||
    node.matches('input') &&
      !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color']
        .includes(node.attr('type') ?? 'text')
  )

// A select's choices in order, as the values it can hold.
let choices = (select: TElement): string[] =>
  select.querySelectorAll('option')
    .filter((o) => o.attr('disabled') == null)
    .map((o) => o.attr('value') ?? o.textContent)

// Step a select to its next or previous choice, as a browser's arrow keys do,
// and tell its listeners the way a browser would.
let step = (select: TElement, by: number) => {
  let all = choices(select)
  if (!all.length) return
  let i = Math.max(all.indexOf(select.value), 0)
  let next = all[Math.min(Math.max(i + by, 0), all.length - 1)]
  if (next == select.value) return
  select.value = next
  event(select, 'input')
  event(select, 'change')
}

export let interaction = (
  root: TElement,
  open: (href: string) => void,
): {
  press: (k: Key) => boolean
  focus: (node?: TElement) => void
  activate: (node: TElement) => void
  active: () => TElement | null
} => {
  let controls = () =>
    root.querySelectorAll(
      'a,button,input,textarea,select,[tabindex],[role=button]',
    )
      .filter((n) => n.attr('disabled') == null && n.attr('tabindex') != '-1')
  // Focus one control, kept in sight with its caret at the end, or none.
  let focus = (node?: TElement) => {
    if (!node) return doc.activeElement?.blur()
    node.focus()
    node.scrollIntoView()
    if (node.matches('input,textarea')) {
      node.setSelectionRange(node.value.length, node.value.length)
      node.setAttribute('data-caret', node.value.length)
    }
  }
  // Tab and Shift-Tab: the next control in reading order, round the ends.
  let tab = (node: TElement | null, back: boolean) => {
    let list = controls()
    let i = node ? list.indexOf(node) : -1
    if (i < 0 && back) i = 0
    focus(list[(i + (back ? -1 : 1) + list.length) % list.length])
  }
  onNavigate(open)
  let activate = (node: TElement) => node.click()
  let active = () => {
    let node = doc.activeElement
    if (node && !root.contains(node)) {
      node.blur()
      return null
    }
    return node
  }
  let press = (k: Key): boolean => {
    if (k.name == 'char' && (k.text?.length ?? 0) > 1) {
      for (let text of k.text!) press({ ...k, text })
      return true
    }
    let node = active()
    let typing = entering(node)
    if (k.name == 'tab' && !typing) {
      tab(node, !!k.shift)
      return true
    }
    let target = node ?? root
    let key = names[k.name] ?? k.text ?? ''
    let e = event(target, 'keydown', {
      key,
      shiftKey: !!k.shift,
      ctrlKey: !!k.ctrl,
      altKey: !!k.alt,
      metaKey: false,
      repeat: false,
    })
    if (k.name == 'escape') {
      node?.removeAttribute('data-caret')
      focus()
      return true
    }
    if (e.defaultPrevented) return true
    if (node?.matches('select') && ['left', 'right'].includes(k.name)) {
      step(node, k.name == 'left' ? -1 : 1)
      return true
    }
    if (typing && node) {
      if (k.name == 'tab') {
        tab(node, !!k.shift)
        return true
      }
      // Text typed over in place holds its text as its content, and Enter
      // there is a new line (what it does otherwise, it does on keydown).
      let inPlace = node.isContentEditable
      if (k.name == 'enter' && !k.shift && !inPlace) {
        let form = node.closest('form')
        if (form) event(form, 'submit')
        return true
      }
      let next = edit(
        {
          text: inPlace ? node.textContent : node.value,
          at: node.selectionStart,
        },
        k.name == 'enter' ? { name: 'char', text: '\n' } : k,
      )
      if (next) {
        if (inPlace) node.textContent = next.text
        else node.value = next.text
        node.setSelectionRange(next.at, next.at)
        node.setAttribute('data-caret', next.at)
        event(node, 'input')
        event(node, 'select')
      }
      return true
    }
    if (['up', 'down', 'pageup', 'pagedown'].includes(k.name)) {
      let scroller = node?.closest('[scroll]') ??
        root.querySelector('[scroll]')
      if (scroller) {
        event(scroller, 'wheel', {
          deltaY: k.name == 'up' || k.name == 'pageup' ? -1 : 1,
        })
        return true
      }
    }
    if (node && (k.name == 'enter' || k.name == 'char' && k.text == ' ')) {
      activate(node)
      return true
    }
    return false
  }
  return { press, focus, activate, active }
}
