/**
 * @yaks/native: the kits' Preact tree, painted as native views. Preact
 * renders into @yaks/tui's in-memory DOM, as it does for a terminal; `paint`
 * reads that tree into plain nodes a native host draws with its own widgets:
 * a box, a run of text, a press, a field, a toggle. It holds no widget and
 * imports no platform, so it runs and is tested anywhere; the host (the iOS
 * shell's `native/kit.tsx`) maps each node to a React Native view.
 *
 * A node's look is the merge of its tag's defaults and the native style of
 * each class it wears, read from a {@link Look} (look.ts). What a press or a
 * typed character means stays the app's: the node carries the act that
 * delivers it to the element, as a browser's event would.
 *
 * @module
 */

import { type ComponentChild, render } from 'preact'
import {
  dispatch,
  install,
  onPaint,
  type TElement,
  type TNode,
  TText,
} from '@yaks/tui/dom'

/** A native style: a React Native style object's keys and values. */
export type Style = Record<string, string | number>

/** The native look: each class's style, and each tag's. */
export type Look = {
  classes: Record<string, Style>
  tags: Record<string, Style>
}

/** One run of text inside a text node: words, or a styled inline element. */
export type Run = string | Text

/** Words, drawn in one native text view; nested runs keep their style. */
export type Text = {
  kind: 'text'
  key: number
  style: Style
  runs: Run[]
  press?: () => void
}

/** A box laid out by flex, holding other nodes. */
export type Box = {
  kind: 'box'
  key: number
  style: Style
  children: Node[]
  press?: () => void
}

/** A text field: what it shows, and the acts typing and submitting are. */
export type Field = {
  kind: 'field'
  key: number
  style: Style
  value: string
  placeholder: string
  lines: boolean
  type: (text: string) => void
  submit: () => void
}

/** A check box: whether it is on, and the act of flipping it. */
export type Toggle = {
  kind: 'toggle'
  key: number
  style: Style
  on: boolean
  label: Run[]
  flip: () => void
}

/** What a native host draws. */
export type Node = Text | Box | Field | Toggle

// Elements whose words run inline with their neighbours'.
let INLINE = new Set([
  'a',
  'abbr',
  'b',
  'code',
  'em',
  'i',
  'kbd',
  'mark',
  'small',
  'span',
  'strong',
  'time',
])

// Elements that are never drawn.
let UNSEEN = new Set(['head', 'script', 'style', 'template'])

let keys = new WeakMap<TNode, number>()
let next = 0
let keyOf = (n: TNode) => {
  let k = keys.get(n)
  if (k == null) keys.set(n, k = ++next)
  return k
}

let elements = (n: TElement) =>
  n.childNodes.filter((c): c is TElement => !(c instanceof TText))

let styleOf = (el: TElement, look: Look): Style =>
  Object.assign(
    {},
    look.tags[el.localName],
    ...el.className.split(' ').filter(Boolean).map((c) => look.classes[c]),
  )

// The style words take from the boxes around them, as a browser's text
// inherits its ink and size; a native box passes none on by itself.
let WORDS = [
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
]

let worn = (style: Style): Style =>
  Object.fromEntries(Object.entries(style).filter(([k]) => WORDS.includes(k)))

// Whether an element takes a press: a button, a link, a summary (which opens
// its details), or anything the app listens to clicks on.
let pressable = (el: TElement) =>
  el.localName == 'button' || el.localName == 'summary' ||
  el.hasAttribute('href') || el.hasAttribute('data-href') ||
  el.handlers.has('click')

// What a closed `details` shows of what it holds: its summary alone.
let shut = (el: TElement, c: TNode) =>
  el.localName == 'details' && !el.hasAttribute('open') &&
  (c instanceof TText || (c as TElement).localName != 'summary')

// A press clicks it, which submits a submit button's form and flips a box,
// as a browser's click does (@yaks/tui/dom).
let pressOf = (el: TElement) =>
  pressable(el) && !el.hasAttribute('disabled') ? () => el.click() : undefined

// Whether everything inside is words: text nodes and inline elements only.
let worded = (el: TElement): boolean =>
  el.childNodes.every((c) =>
    c instanceof TText ||
    INLINE.has((c as TElement).localName) && worded(c as TElement)
  )

let runs = (el: TElement, look: Look): Run[] =>
  el.childNodes.map((c) =>
    c instanceof TText ? c.data : text(c as TElement, look, {})
  )

let text = (el: TElement, look: Look, around: Style): Text => ({
  kind: 'text',
  key: keyOf(el),
  style: { ...around, ...styleOf(el, look) },
  runs: runs(el, look),
  ...pressOf(el) && { press: pressOf(el) },
})

let event = (type: string, cancelable = false) =>
  new Event(type, { bubbles: true, cancelable })

let field = (el: TElement, look: Look): Field => ({
  kind: 'field',
  key: keyOf(el),
  style: styleOf(el, look),
  value: el.value,
  placeholder: el.getAttribute('placeholder') ?? '',
  lines: el.localName == 'textarea',
  type: (typed) => {
    el.value = typed
    dispatch(el, event('input'))
  },
  submit: () => {
    let form = el.closest('form')
    if (form) dispatch(form, event('submit', true))
    else {
      dispatch(
        el,
        Object.assign(event('keydown', true), { key: 'Enter' }),
      )
    }
  },
})

let toggle = (el: TElement, label: Run[], look: Look): Toggle => ({
  kind: 'toggle',
  key: keyOf(el),
  style: styleOf(el, look),
  on: el.checked,
  label,
  flip: () => el.click(),
})

let isBox = (el: TElement, type: string) =>
  el.localName == 'input' && (el.getAttribute('type') ?? 'text') == type

/** Paint one element and what it holds as native nodes; a text node beside
 * elements becomes a text of its own, since a native box holds no bare
 * words. */
export let paint = (
  el: TElement,
  look: Look,
  around: Style = {},
): Node | null => {
  if (UNSEEN.has(el.localName) || el.hasAttribute('hidden')) return null
  if (isBox(el, 'checkbox') || isBox(el, 'radio')) return toggle(el, [], look)
  if (el.localName == 'input' || el.localName == 'textarea') {
    return field(el, look)
  }
  // A label around a box and its words is one toggle, its words the label.
  let box = elements(el).find((c) => isBox(c, 'checkbox') || isBox(c, 'radio'))
  if (el.localName == 'label' && box) {
    let words = el.childNodes.filter((c) => c != box) as TNode[]
    return {
      ...toggle(box, [], look),
      style: { ...around, ...styleOf(el, look) },
      label: words.map((c) =>
        c instanceof TText ? c.data : text(c as TElement, look, {})
      ),
    }
  }
  if (el.childNodes.length && worded(el)) return text(el, look, around)
  let style = styleOf(el, look)
  let inner = { ...around, ...worn(style) }
  return {
    kind: 'box',
    key: keyOf(el),
    style,
    children: el.childNodes.flatMap((c): Node[] => {
      if (shut(el, c)) return []
      if (c instanceof TText) {
        return c.data.trim()
          ? [{ kind: 'text', key: keyOf(c), style: inner, runs: [c.data] }]
          : []
      }
      let n = paint(c as TElement, look, inner)
      return n ? [n] : []
    }),
    ...pressOf(el) && { press: pressOf(el) },
  }
}

/** Render a tree into the in-memory DOM and hand `drawn` its painted nodes
 * after every change, as a terminal repaints; the answer unmounts it. The
 * DOM is one per process, so one tree is mounted at a time. */
export let mount = (
  node: ComponentChild,
  look: Look,
  drawn: (painted: Node | null) => void,
): () => void => {
  let { root, free } = install()
  let host = root as unknown as Parameters<typeof render>[1]
  onPaint(() => drawn(paint(root, look)))
  render(node, host)
  return () => {
    render(null, host)
    onPaint(() => {})
    free()
  }
}

export { type Colors, look } from './look.ts'
