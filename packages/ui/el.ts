/**
 * The two builders every UI component is made from. They speak the
 * `Block_Element-modifier` class names a stylesheet and a terminal sheet both
 * read: `el('span', 'Dot')` is a component rendering `<span class="Dot">`, and
 * its `mod` prop adds variants, `<Dot mod='ring' />` rendering
 * `<span class="Dot Dot-ring">`. `block()` hangs a block's elements on it.
 *
 * A part is paint. Everything a caller passes besides `mod`, `className` (or
 * `class`), `elRef`, `href` and `as` (a style, a handler, `draggable`, `type`) lands on the
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
 * for `[data-href]` once for the whole document. A link to another site opens
 * in a new tab (@yaks/markdown/away), by the page's `Site` where one is given,
 * unless the caller names its own target.
 *
 * @module
 */

import {
  type Context,
  createContext,
  createElement as h,
  type FunctionComponent,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { away } from '@yaks/markdown/away'
import { Site } from '@yaks/markdown/site'

type Mod = string | false | null | undefined

/** What a part takes: its variants, and anything else an element does. */
export type Props = {
  /** variants, each adding `Base-variant` to the class; falsy ones drop */
  mod?: Mod | Mod[]
  /** more classes, after the part's own */
  className?: string
  /** more classes, as HTML names them: `className` too */
  class?: string
  /** the element itself, as `ref` would give it (a function component
   * cannot forward `ref`) */
  elRef?: unknown
  /** where this part links to */
  href?: string
  /** the element to render, where the page's outline wants another, or a
   * part to draw this one as */
  as?: string | Part
  children?: ReactNode
  [x: string]: unknown
}

/** A component `el()` made. */
export type Part = FunctionComponent<Props>

/** The link around this point of the tree: what an `href` inside it means. */
export let Surround: Context<{ href?: string }> = createContext({})

let face = (
  props: Record<string, unknown>,
  className: string,
  ref: unknown,
  children: ReactNode,
): Record<string, unknown> => ({
  ...props,
  ref,
  className,
  ...(children !== undefined && { children }),
})

type Attrs = Record<string, unknown>
type Cancel = (event: Event) => void

// Layers dispatch cancel on their own element, including those using an
// element other than dialog. Listen there so both renderers hear the event.
let Cancelable = ({ tag, attrs, cancel }: {
  tag: string
  attrs: Attrs
  cancel: Cancel
}) => {
  let node = useRef<Element | null>(null)
  let ref = useMemo(() => (at: Element | null) => {
    node.current = at
    let given = attrs.ref
    if (typeof given == 'function') return given(at)
    if (given) (given as { current: Element | null }).current = at
  }, [attrs.ref])
  useLayoutEffect(() => {
    let at = node.current
    at?.addEventListener('cancel', cancel)
    return () => at?.removeEventListener('cancel', cancel)
  }, [tag, cancel])
  return h(tag, { ...attrs, ref })
}

let element = (tag: string, attrs: Attrs) => {
  if (typeof attrs.onCancel != 'function') return h(tag, attrs)
  let { onCancel, ...rest } = attrs
  return h(Cancelable, { tag, attrs: rest, cancel: onCancel as Cancel })
}

let Linked = ({ href, props, names, elRef, children }: {
  href: string
  props: Record<string, unknown>
  names: string
  elRef: unknown
  children: ReactNode
}) => {
  let site = useContext(Site)
  let surround = useMemo(() => ({ href }), [href])
  return h(
    Surround.Provider,
    { value: surround },
    element('a', face(away({ ...props, href }, site), names, elRef, children)),
  )
}

let classes = (base: string, mod: Props['mod'], extra?: string) => {
  let names = base
  if (Array.isArray(mod)) {
    for (let m of mod) if (m) names += ` ${base}-${m}`
  } else if (mod) {
    names += ` ${base}-${mod}`
  }
  return extra ? `${names} ${extra}` : names
}

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
export let el = <P extends Props = Props>(
  tag: string | FunctionComponent<P>,
  base: string,
): FunctionComponent<P> =>
(
  { mod, className, class: named, elRef, children, href, as, ...props }: Props,
) => {
  let extra = className && named ? `${className} ${named}` : className || named
  let names = classes(base, mod, extra)
  let outer = useContext(Surround).href
  let d = drawn(tag as string | Part, as)
  // Drawn as another part, which makes the element and its link.
  if (d.look) {
    return h(d.look, {
      ...props,
      as: d.tag,
      className: names,
      elRef,
      href,
      children,
    })
  }
  // A part given no children passes none, rather than children that are
  // nothing: a textarea's `value` is its content only when it has none.
  if (href && !outer) return h(Linked, { href, props, names, elRef, children })
  if (href && href != outer) {
    props = { ...props, role: 'link', tabIndex: 0, 'data-href': href }
  }
  return element(d.tag!, face(props, names, elRef, children))
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
