/**
 * The two builders every UI component is made from. They speak the
 * `Block_Element-modifier` class names a stylesheet and a terminal sheet both
 * read: `el('span', 'Dot')` is a component rendering `<span class="Dot">`, and
 * its `mod` prop adds variants, `<Dot mod='ring' />` rendering
 * `<span class="Dot Dot-ring">`. `block()` hangs a block's elements on it.
 *
 * A part is paint. Everything a caller passes besides `mod`, `class`, `elRef`,
 * `href` and `as` (a style, a handler, `draggable`, `type`) lands on the
 * element as given; what a click on it means is the caller's business. `as`
 * names the element where the page's outline wants another than the part's
 * own: a card's title as an `h3` under the page's `h2`, a card as an `li` of
 * a list.
 *
 * A part can be another part too, drawn as it and wearing both classes. `as`
 * given a part draws this one as it, in this one's element:
 * `<TabSet.Panel as={Card}>` renders `<section class="Card Tabs_Panel">`, a
 * panel that is a card. A part made of one (`el(Button, 'Copy_Go')`, or a
 * block's element given a part) always is it, in that part's element. Its
 * variants are its own; the part it is drawn as is plain.
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
  /** the element to render, where the page's outline wants another, or a
   * part to draw this one as */
  as?: string | Part
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
  !mod && !extra ? base : [
    base,
    ...[mod].flat().filter(Boolean).map((m) => `${base}-${m}`),
    extra,
  ].filter(Boolean).join(' ')

// Which of a part's own tag and the `as` it is given is the element, and
// which the part it is drawn as.
let drawn = (tag: string | Part, as?: string | Part) =>
  typeof as == 'function'
    ? { look: as, tag: typeof tag == 'string' ? tag : undefined }
    : typeof tag == 'function'
    ? { look: tag, tag: as }
    : { tag: as ?? tag }

/** A part: `tag` (an element, or a part it is drawn as), wearing the class
 * `base`. */
export let el =
  (tag: string | Part, base: string): Part =>
  ({ mod, class: extra, elRef, children, href, as, ...props }: Props) => {
    let d = drawn(tag, as)
    // Drawn as another part, which makes the element and its link. Whether
    // a part is drawn so is fixed where it is written, so hooks keep order.
    if (d.look) {
      let names = classes(base, mod, extra)
      return h(d.look, {
        ...props,
        as: d.tag,
        class: names,
        elRef,
        href,
        children,
      })
    }
    let a = anchor(d.tag!, href, useContext(Surround).href)
    // A part given no children passes none, rather than children that are
    // nothing: a textarea's `value` is its content only when it has none.
    let node = h(a.tag, {
      ...props,
      ...(a.href && { href: a.href }),
      ...(a.demote && { role: 'link', tabIndex: 0, 'data-href': a.demote }),
      ref: elRef,
      class: classes(base, mod, extra),
      ...(children !== undefined && { children }),
    })
    // One value per href: a fresh object each render would wake every nested
    // reader as a render of its own.
    let surround = useMemo(() => ({ href: a.href }), [a.href])
    return a.href ? h(Surround.Provider, { value: surround }, node) : node
  }

/** A block and its elements: `block('section', 'Card', { Head: 'header' })`
 * renders `<section class="Card">`, and carries `Card.Head`, rendering
 * `<header class="Card_Head">`. Each key is the element's name, its value
 * the element's tag, or the part it is. */
export let block = <K extends string>(
  tag: string | Part,
  base: string,
  kids: Record<K, string | Part>,
): Part & Record<K, Part> =>
  Object.assign(
    el(tag, base),
    Object.fromEntries(
      Object.entries<string | Part>(kids).map((
        [k, t],
      ) => [k, el(t, `${base}_${k}`)]),
    ) as Record<K, Part>,
  )
