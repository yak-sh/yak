/**
 * A view drawn as the browser's own nodes, exported as `@yaks/html/dom`: what
 * `markup` (./mod.ts) would serialize, drawn by React DOM into a document's
 * nodes that stand nowhere yet. A page that draws a view again as its rows move
 * morphs what stands into them. In the browser this needs no second renderer:
 * React DOM is already the page's, where React's server renderer is a
 * quarter-megabyte more of script.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { createElement as h } from 'react'
 * import { parseHTML } from 'linkedom'
 * import { fragment } from '@yaks/html/dom'
 * import { raw } from '@yaks/html/raw'
 *
 * let { document } = parseHTML('<!doctype html><body></body>')
 * let drawn = fragment(document, h('p', null, 'a&b ', raw('<i>c</i>')))
 * document.body.append(drawn)
 * assertEquals(document.body.innerHTML, '<p>a&amp;b <i>c</i></p>')
 * ```
 *
 * @module
 */

import type { ReactNode } from 'react'
import { draw } from '@yaks/react/draw'
import { SLOT, slotted } from './raw.ts'

/** `node` drawn as nodes of `doc`, each trusted fragment spliced in where the
 * view put it. */
export let fragment = (doc: Document, node: ReactNode): DocumentFragment => {
  let fragments: string[] = []
  let into = doc.createElement('div')
  let close = draw(slotted(node, fragments), into)
  let drawn = doc.createDocumentFragment()
  try {
    for (let input of into.querySelectorAll<HTMLInputElement>('input')) {
      // Morph reads the new defaults from attributes, and cloning a node
      // need not carry the live state of a control.
      if (typeof input.defaultChecked == 'boolean') {
        input.toggleAttribute('checked', input.defaultChecked)
      }
    }
    drawn.append(...[...into.childNodes].map((n) => n.cloneNode(true)))
  } finally {
    close()
  }
  for (let slot of drawn.querySelectorAll(`template[${SLOT}]`)) {
    let t = doc.createElement('template')
    t.innerHTML = fragments[Number(slot.getAttribute(SLOT))] ?? ''
    slot.replaceWith(t.content)
  }
  return drawn
}
