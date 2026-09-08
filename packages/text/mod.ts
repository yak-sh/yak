/**
 * @yaks/text owns the text host for portable renderer trees: Markdown for mail
 * and documents, plain text for a CLI or terminal. h records the same tags
 * Preact receives; markdown and plain serialize them without a DOM. Content
 * loses every C0/DEL/C1 byte in text and hrefs, including literal newlines and
 * tabs. Only structural elements introduce output line breaks. Code retains
 * punctuation, not control bytes. Unknown elements keep their children.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { define } from '@yaks/render'
 * import { loadVocab } from '@yaks/vocab'
 * import { render } from '@yaks/text'
 *
 * let registry = define([{
 *   view: 'Tile', match: true,
 *   render: (b, h) => h('h2', null, b.entity.eid),
 * }])
 * let bundle = {entity: {eid: 'a'}}
 * let vocab = loadVocab([])
 * assertEquals(render(registry, bundle, 'Tile', vocab), '## a')
 * assertEquals(render(registry, bundle, 'Tile', vocab, {}, 'plain'), 'a')
 * ```
 *
 * @module
 */

import {
  type Bundle,
  type Child,
  type Context,
  type Registry,
  type RenderContext,
  resolve,
} from '@yaks/render'
import type { Vocab } from '@yaks/vocab'
import { format, type Mode } from './format.ts'
import { h, type Node } from './tree.ts'

export { h, type Node } from './tree.ts'
export type { Mode } from './format.ts'
export { safe, safeHref } from './safe.ts'

/** Render a tree as Markdown, escaping literal text and preserving code. */
export let markdown = (child: Child<Node>): string => format(child, 'markdown')

/** Render a tree without Markdown emphasis or code markers; links keep their URL. */
export let plain = (child: Child<Node>): string => format(child, 'plain')

/** Resolve and serialize a portable renderer; a missing view yields empty text. */
export let render = (
  registry: Registry,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context = {},
  mode: Mode = 'markdown',
): string => {
  let tree = (view: string | undefined, ctx: Context): Node | null => {
    let context: RenderContext<Node> = {
      ...ctx,
      readOnly: true,
      render: (view, overrides) => tree(view, { ...ctx, ...overrides }),
    }
    return resolve(registry, bundle, view, vocab, context)?.render(
      bundle,
      h,
      context,
    ) ?? null
  }
  return format(tree(view, ctx), mode)
}
