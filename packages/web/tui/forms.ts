// Keyboard interaction at the terminal boundary. Domain forms keep their own
// writes and drafts; this adapter delivers the same events as a browser.
import { type Edit, edit, type TElement } from '@yaks/tui'
import { pane } from './paint.ts'
import { editing } from './keys.ts'

export let control = (root: TElement, line: number): TElement | undefined => {
  for (let segment of pane(root).lines[line] ?? []) {
    for (let node = segment.owner; node; node = node.parentNode ?? undefined) {
      if (['button', 'input', 'textarea'].includes(node.localName)) return node
    }
  }
}

let fire = (
  node: TElement,
  type: string,
  props: Record<string, unknown> = {},
) => {
  let event = {
    type,
    target: node,
    currentTarget: node,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {},
    ...props,
  }
  let handler = node.handlers.get(type)
  if (typeof handler == 'function') handler.call(node, event)
  return event.defaultPrevented
}

export let click = (node: TElement): boolean => {
  if (node.localName != 'button' || node.attr('disabled') != null) return false
  fire(node, 'click')
  return true
}

export let field = (node: TElement) => {
  node.focus()
  let state: Edit = { text: node.value, at: node.value.length }
  let caret = () => {
    node.setSelectionRange(state.at, state.at)
    node.setAttribute('data-caret', state.at)
  }
  caret()
  return {
    close() {
      node.removeAttribute('data-caret')
      node.blur()
    },
    key(token: string) {
      if (token == '\r') {
        if (!fire(node, 'keydown', { key: 'Enter', shiftKey: false })) {
          for (
            let parent = node.parentNode;
            parent;
            parent = parent.parentNode
          ) {
            if (parent.localName == 'form') {
              fire(parent, 'submit')
              break
            }
          }
        }
        return
      }
      let key = token == '\n'
        ? { name: 'char' as const, text: '\n' }
        : editing(token)
      let next = key && edit(state, key)
      if (!next) return
      state = next
      node.value = state.text
      caret()
      fire(node, 'input')
    },
  }
}
