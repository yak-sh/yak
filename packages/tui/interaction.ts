/** Keyboard focus and native form events for any tree painted by the terminal.
 * The app owns links and history; this adapter knows only DOM controls. */
import { dispatch, doc, type TElement, touch } from './dom.ts'
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

export let interaction = (
  root: TElement,
  open: (href: string) => void,
): {
  press: (k: Key) => boolean
  focus: (node?: TElement) => void
  activate: (node: TElement) => void
} => {
  let selected: TElement | undefined
  let controls = () =>
    root.querySelectorAll(
      'a,button,input,textarea,select,[tabindex],[role=button]',
    )
      .filter((n) => n.attr('disabled') == null && n.attr('tabindex') != '-1')
  let focus = (node?: TElement) => {
    selected?.removeAttribute('data-terminal-focus')
    selected?.removeAttribute('reveal')
    doc.activeElement?.blur()
    selected = node
    if (node) {
      node.focus()
      node.setAttribute('data-terminal-focus', '')
      node.setAttribute('reveal', '')
      if (node.matches('input,textarea')) {
        node.setSelectionRange(node.value.length, node.value.length)
        node.setAttribute('data-caret', node.value.length)
      }
    }
    touch()
  }
  let activate = (node: TElement) => {
    let e = event(node, 'click', {
      button: 0,
      detail: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    })
    if (!e.defaultPrevented) {
      let href = node.attr('href') ?? node.attr('data-href')
      if (href) open(href)
    }
  }
  let press = (k: Key): boolean => {
    if (k.name == 'char' && (k.text?.length ?? 0) > 1) {
      for (let text of k.text!) press({ ...k, text })
      return true
    }
    let node = doc.activeElement
    if (node && !root.contains(node)) {
      node.blur()
      node = null
    }
    let typing = !!node?.matches('input,textarea,select,[contenteditable]')
    if (
      k.name == 'tab' && !typing ||
      !typing && k.name == 'char' && (k.text == 'j' || k.text == 'k')
    ) {
      let list = controls()
      let i = list.indexOf(node ?? selected!)
      let step = k.shift || k.text == 'k' ? -1 : 1
      focus(list[(i + step + list.length) % list.length])
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
    if (typing && node) {
      if (k.name == 'tab') {
        let list = controls()
        focus(
          list[
            (list.indexOf(node) + (k.shift ? -1 : 1) + list.length) %
            list.length
          ],
        )
        return true
      }
      if (k.name == 'enter' && !k.shift) {
        let form = node.closest('form')
        if (form) event(form, 'submit')
        return true
      }
      let next = edit(
        { text: node.value, at: node.selectionStart },
        k.name == 'enter' ? { name: 'char', text: '\n' } : k,
      )
      if (next) {
        node.value = next.text
        node.setSelectionRange(next.at, next.at)
        node.setAttribute('data-caret', next.at)
        event(node, 'input')
        event(node, 'select')
      }
      return true
    }
    if (['up', 'down', 'pageup', 'pagedown'].includes(k.name)) {
      let scroller = node?.closest('[scroll]') ??
        root.querySelector('.App_Body')
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
  return { press, focus, activate }
}
