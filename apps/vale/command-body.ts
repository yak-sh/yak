// Render a command's Markdown through @yaks/markdown's structural nodes. The
// DOM host only creates elements and text; command content never becomes HTML.
import { parse, render } from '@yaks/markdown'
import type { Child, H } from '@yaks/render'

let array = (
  child: Child<HTMLElement>,
): child is readonly Child<HTMLElement>[] => Array.isArray(child)

let append = (parent: HTMLElement, child: Child<HTMLElement>): void => {
  if (array(child)) {
    for (let part of child) append(parent, part)
  } else if (child != null && typeof child != 'boolean') {
    parent.append(typeof child == 'number' ? String(child) : child)
  }
}

let host: H<HTMLElement> = (tag, props, ...children) => {
  let node = document.createElement(tag)
  for (let [name, value] of Object.entries(props ?? {})) {
    if (value != null) node.setAttribute(name, String(value))
  }
  for (let child of children) append(node, child)
  return node
}

export let commandBody = (text: string): HTMLElement =>
  render(parse(text), host)
