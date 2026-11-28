/**
 * @yaks/html serializes portable registry views as server-side HTML. Selection
 * and tree construction go through @yaks/react; React's server renderer owns
 * HTML escaping, attributes and void elements. No DOM is installed. The
 * browser draws the same views with ./dom.ts.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { define } from '@yaks/render'
 * import { loadVocab } from '@yaks/vocab'
 * import { render } from '@yaks/html'
 *
 * let registry = define([{
 *   view: 'Tile', match: true,
 *   render: (b, h) => h('p', null, b.entity.eid),
 * }])
 * assertEquals(
 *   render(registry, {entity: {eid: 'a&b'}}, 'Tile', loadVocab([])),
 *   '<p>a&amp;b</p>',
 * )
 * ```
 *
 * @module
 */

import { render as react } from '@yaks/react'
import type { Bundle, Context, Registry } from '@yaks/render'
import type { Vocab } from '@yaks/vocab'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { SLOT, slotted } from './raw.ts'

export { raw } from './raw.ts'

/** Render static HTML without wrapping nested trusted fragments. Text
 * children still go through the serializer's normal escaping. */
export let markup = (node: ReactNode): string => {
  let fragments: string[] = []
  let rendered = renderToStaticMarkup(slotted(node, fragments))
  return fragments.length
    ? rendered.replace(
      new RegExp(`<template ${SLOT}="(\\d+)"></template>`, 'g'),
      (tag, index) => fragments[Number(index)] ?? tag,
    )
    : rendered
}

/** Resolve and serialize a portable view; an unmatched view yields empty HTML. */
export let render = (
  registry: Registry,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context = {},
): string => {
  let node = react(registry, bundle, view, vocab, ctx)
  return node ? markup(node) : ''
}
