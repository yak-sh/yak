/**
 * A text host tree records elements until serialization. Keeping text leaves
 * separate from host formatting lets the boundary remove content's control
 * bytes without erasing line breaks introduced by paragraphs, lists or br.
 */

import type { Child, H } from '@yaks/render'

/** An element produced by the text hyperscript; no DOM is needed. */
export type Node = {
  tag: string
  props: Record<string, unknown> | null
  children: Child<Node>[]
}

/**
 * Record an element for markdown() or plain(). Text is escaped at serialization,
 * so code can keep its literal punctuation and every path shares the boundary.
 *
 * Headings:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * for (let level of [1, 2, 3, 4, 5, 6]) {
 *   let node = h(`h${level}`, null, 'A page')
 *   assertEquals(markdown(node), `${'#'.repeat(level)} A page`)
 *   assertEquals(plain(node), 'A page')
 * }
 * ```
 *
 * Paragraphs and line breaks:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * let node = h('div', null, h('p', null, 'One'),
 *   h('p', null, 'Two', h('br', null), 'Three'))
 * assertEquals(markdown(node), 'One\n\nTwo  \nThree')
 * assertEquals(plain(node), 'One\n\nTwo\nThree')
 * ```
 *
 * Unordered lists:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * let node = h('ul', null, h('li', null, 'One'), h('li', null, 'Two'))
 * assertEquals(markdown(node), '- One\n- Two')
 * assertEquals(plain(node), '- One\n- Two')
 * ```
 *
 * Ordered lists:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * let node = h('ol', {start: 3}, h('li', null, 'One'), h('li', null, 'Two'))
 * assertEquals(markdown(node), '3. One\n4. Two')
 * assertEquals(plain(node), '3. One\n4. Two')
 * ```
 *
 * Links:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * let node = h('a', {href: 'https://yaks.app'}, 'Open')
 * assertEquals(markdown(node), '[Open](https://yaks.app)')
 * assertEquals(plain(node), 'Open (https://yaks.app)')
 * ```
 *
 * Inline code:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * let node = h('code', null, 'a * b')
 * assertEquals(markdown(node), '`a * b`')
 * assertEquals(plain(node), 'a * b')
 * ```
 *
 * Fenced code (br supplies the line break):
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * let node = h('pre', null, h('code', null, 'one', h('br', null), 'two'))
 * let fence = '`'.repeat(3)
 * assertEquals(markdown(node), `${fence}\none\ntwo\n${fence}`)
 * assertEquals(plain(node), 'one\ntwo')
 * ```
 *
 * Emphasis:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * for (let tag of ['strong', 'b', 'em', 'i']) {
 *   let node = h(tag, null, 'word')
 *   let marker = tag == 'strong' || tag == 'b' ? '**' : '*'
 *   assertEquals(markdown(node), `${marker}word${marker}`)
 *   assertEquals(plain(node), 'word')
 * }
 * ```
 *
 * Inline and unknown wrappers keep their children:
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { h, markdown, plain } from '@yaks/text'
 * let node = h('custom', null, h('span', null, 'A'), [' ', 0, false, null])
 * assertEquals(markdown(node), 'A 0')
 * assertEquals(plain(node), 'A 0')
 * ```
 */
export let h: H<Node> = (tag, props, ...children) => ({ tag, props, children })
