/**
 * The two builders every UI component is made from. They speak the
 * `Block_Element-modifier` class names a stylesheet and a terminal sheet both
 * read: `el('span', 'Dot')` is a component rendering `<span class="Dot">`, and
 * its `mod` prop adds variants, `<Dot mod='ring' />` rendering
 * `<span class="Dot Dot-ring">`. `block()` hangs a block's elements on it.
 *
 * A part is paint. Everything a caller passes besides `mod`, `class`, `elRef`
 * and `href` (a style, a handler, `draggable`, `type`) lands on the element
 * as given; what a click on it means is the caller's business.
 *
 * Links nest the way HTML allows. A part given an `href` renders as an `<a>`
 * and becomes the link around its children ({@link Surround}). Inside it, a
 * part naming the same href is not a second link, and one naming another
 * keeps its tag and says `role="link"` and `data-href`: nested `<a>` is
 * invalid HTML, so following it is left to the application, which listens
 * for `[data-href]` once for the whole document.
 *
 * @module
 */

import {
  type ComponentChildren,
  type Context,
  createContext,
  type FunctionComponent,
  h,
} from 'preact'
import { useContext, useMemo } from 'preact/hooks'

type Mod = string | false | null | undefined

/** What a part takes: its variants, and anything else an element does. */
export type Props = {
  /** variants, each adding `Base-variant` to the class; falsy ones drop */
  mod?: Mod | Mod[]
  /** more classes, after the part's own */
  class?: string
  /** the element itself, as `ref` would give it (a function component
   * cannot forward `ref`) */
  elRef?: unknown
  /** where this part links to */
  href?: string
  children?: ComponentChildren
  [x: string]: unknown
}

/** A component `el()` made. */
export type Part = FunctionComponent<Props>

/** The link around this point of the tree: what an `href` inside it means. */
export let Surround: Context<{ href?: string }> = createContext({})

// An href with no link around it makes an <a>; the same href inside that
// link drops; another href demotes to data-href.
let anchor = (tag: string, href?: string, outer?: string) =>
  !href || href == outer
    ? { tag }
    : outer
    ? { tag, demote: href }
    : { tag: 'a', href }

let classes = (base: string, mod: Props['mod'], extra?: string) =>
  [
    base,
    ...[mod].flat().filter(Boolean).map((m) => `${base}-${m}`),
    extra,
  ].filter(Boolean).join(' ')

/** A part: `tag`, wearing the class `base`. */
export let el =
  (tag: string, base: string): Part =>
  ({ mod, class: extra, elRef, children, href, ...props }: Props) => {
    let a = anchor(tag, href, useContext(Surround).href)
    let node = h(a.tag, {
      ...props,
      ...(a.href && { href: a.href }),
      ...(a.demote && { role: 'link', tabIndex: 0, 'data-href': a.demote }),
      ref: elRef,
      class: classes(base, mod, extra),
    }, children)
    // One value per href: a fresh object each render would wake every nested
    // reader as a render of its own.
    let surround = useMemo(() => ({ href: a.href }), [a.href])
    return a.href ? h(Surround.Provider, { value: surround }, node) : node
  }

/** A block and its elements: `block('section', 'Card', { Head: 'header' })`
 * renders `<section class="Card">`, and carries `Card.Head`, rendering
 * `<header class="Card_Head">`. Each key is the element's name, its value
 * the element's tag. */
export let block = <K extends string>(
  tag: string,
  base: string,
  kids: Record<K, string>,
): Part & Record<K, Part> =>
  Object.assign(
    el(tag, base),
    Object.fromEntries(
      Object.entries<string>(kids).map(([k, t]) => [k, el(t, `${base}_${k}`)]),
    ) as Record<K, Part>,
  )
