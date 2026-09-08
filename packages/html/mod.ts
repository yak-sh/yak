/**
 * @yaks/html serializes portable registry views as server-side HTML. Selection
 * and tree construction go through @yaks/preact; Preact's server serializer
 * owns HTML escaping, attributes and void elements. No DOM is installed.
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

import { render as preact } from '@yaks/preact'
import type { Bundle, Context, Registry } from '@yaks/render'
import type { Vocab } from '@yaks/vocab'
import { renderToString } from 'preact-render-to-string'

/** Resolve and serialize a portable view; an unmatched view yields empty HTML. */
export let render = (
  registry: Registry,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context = {},
): string => {
  let node = preact(registry, bundle, view, vocab, ctx)
  return node ? renderToString(node) : ''
}
