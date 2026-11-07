/**
 * @yaks/native: the kits' Preact tree, painted as native views. Preact
 * renders into @yaks/dom's in-memory DOM, as it does for a terminal; `paint`
 * reads that tree into plain nodes a native host draws with its own widgets:
 * a box, a run of text, a press, a field, a toggle, a pick, a drawing, an
 * image, and what only a browser draws (`web`). It holds no widget and
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

import { Component, type ComponentChild, h, render } from 'preact'
import {
  dispatch,
  install,
  onNavigate,
  onPaint,
  type TElement,
  type TNode,
  TText,
} from '@yaks/dom'

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

/** How a field's keyboard behaves, in React Native's `TextInput` terms,
 * read from what the element says it takes (`type`, `inputmode`,
 * `enterkeyhint`, `autocomplete`, `autocapitalize`, `autofocus`). */
export type Traits = {
  keyboardType?:
    | 'email-address'
    | 'numeric'
    | 'decimal-pad'
    | 'phone-pad'
    | 'url'
    | 'web-search'
  secureTextEntry?: boolean
  returnKeyType: 'done' | 'go' | 'next' | 'search' | 'send'
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoCorrect?: boolean
  autoComplete?: string
  autoFocus?: boolean
  editable?: boolean
  /** whether submitting keeps the keyboard up: a form that takes one entry
   * after another (a list's "add") does, a lone field does not */
  submitBehavior: 'submit' | 'blurAndSubmit' | 'newline'
}

/** A text field: what it shows, how its keyboard behaves, and the acts
 * typing and submitting are. */
export type Field = {
  kind: 'field'
  key: number
  style: Style
  value: string
  placeholder: string
  lines: boolean
  traits: Traits
  type: (text: string) => void
  submit: () => void
}

/** A choice of one among options (a `select`): the chosen value, what each
 * option says, and the act of choosing one. */
export type Pick = {
  kind: 'pick'
  key: number
  style: Style
  value: string
  options: { value: string; label: string }[]
  disabled: boolean
  choose: (value: string) => void
}

/** One shape of a drawing: its tag (`path`, `circle`, `rect`, …), its
 * attributes, the look its classes give it (`fill`, `stroke`), and the
 * shapes it holds. */
export type Shape = {
  tag: string
  attrs: Record<string, string>
  style: Style
  shapes: Shape[]
}

/** Lines and shapes (an `svg`, as an icon or a chart is), drawn in its
 * words' colour where it says `currentColor`. */
export type Drawing = {
  kind: 'drawing'
  key: number
  style: Style
  attrs: Record<string, string>
  shapes: Shape[]
}

/** A picture from an address. */
export type Picture = {
  kind: 'image'
  key: number
  style: Style
  uri: string
  alt: string
}

/** What only a browser draws (a canvas, a frame, a video), or a view that
 * broke: shown as a notice that it is on the app's web page. */
export type Web = {
  kind: 'web'
  key: number
  style: Style
  tag: string
  words: string
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
export type Node = Text | Box | Field | Toggle | Pick | Drawing | Picture | Web

// Elements whose words run inline with their neighbours'.
let INLINE = new Set([
  'a',
  'abbr',
  'b',
  'br',
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
let UNSEEN = new Set([
  'head',
  'link',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
])

// Elements only a browser draws.
let WEB = new Set([
  'audio',
  'canvas',
  'embed',
  'iframe',
  'math',
  'object',
  'video',
])

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
// as a browser's click does (@yaks/dom).
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
    c instanceof TText
      ? c.data
      : (c as TElement).localName == 'br'
      ? '\n'
      : text(c as TElement, look, {})
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

// Whether pressing it submits its form, as a button does unless it says
// otherwise.
let submits = (el: TElement) =>
  (el.getAttribute('type') ?? (el.localName == 'button' ? 'submit' : '')) ==
    'submit'

// The keyboard each kind of entry brings up, by its `inputmode` or `type`.
let KEYBOARDS: Record<string, Traits['keyboardType']> = {
  email: 'email-address',
  numeric: 'numeric',
  number: 'decimal-pad',
  decimal: 'decimal-pad',
  tel: 'phone-pad',
  url: 'url',
  search: 'web-search',
}

// The return key each `enterkeyhint` names; `enter` and `previous` have no
// iOS key of their own.
let RETURNS: Record<string, Traits['returnKeyType']> = {
  done: 'done',
  go: 'go',
  next: 'next',
  search: 'search',
  send: 'send',
}

// Entries a person types exactly, which take no capital and no correction.
let EXACT = new Set(['email', 'url', 'password', 'tel', 'number'])

/** How a field's keyboard behaves: what it takes, as its attributes say,
 * and whether submitting keeps it up (a form with a submit button does, so
 * one entry follows another, as a list's "add" field does on iOS). */
export let traits = (el: TElement): Traits => {
  let a = (k: string) => el.getAttribute(k) ?? undefined
  let type = el.localName == 'textarea' ? 'textarea' : a('type') ?? 'text'
  let keyboard = KEYBOARDS[a('inputmode') ?? ''] ?? KEYBOARDS[type]
  let form = el.closest('form')
  let exact = EXACT.has(type) || EXACT.has(a('inputmode') ?? '')
  let caps = a('autocapitalize') as Traits['autoCapitalize'] | undefined
  return {
    ...keyboard && { keyboardType: keyboard },
    ...type == 'password' && { secureTextEntry: true },
    returnKeyType: RETURNS[a('enterkeyhint') ?? ''] ??
      (type == 'search' ? 'search' : 'done'),
    ...(caps ?? exact) && { autoCapitalize: caps ?? 'none' },
    ...exact && { autoCorrect: false },
    ...a('autocomplete') && { autoComplete: a('autocomplete') },
    ...el.hasAttribute('autofocus') && { autoFocus: true },
    ...(el.hasAttribute('disabled') || el.hasAttribute('readonly')) &&
      { editable: false },
    submitBehavior: type == 'textarea'
      ? 'newline'
      : form?.querySelectorAll('button,input').some(submits)
      ? 'submit'
      : 'blurAndSubmit',
  }
}

let field = (el: TElement, look: Look): Field => ({
  kind: 'field',
  key: keyOf(el),
  style: styleOf(el, look),
  value: el.value,
  placeholder: el.getAttribute('placeholder') ?? '',
  lines: el.localName == 'textarea',
  traits: traits(el),
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

let words = (n: TNode): string =>
  n instanceof TText ? n.data : (n as TElement).childNodes.map(words).join('')

let options = (el: TElement): TElement[] =>
  elements(el).flatMap((k) => k.localName == 'optgroup' ? elements(k) : [k])
    .filter((k) => k.localName == 'option')

let pick = (el: TElement, look: Look): Pick => {
  let all = options(el).map((o) => ({
    value: o.getAttribute('value') ?? words(o),
    label: words(o).trim(),
    selected: o.hasAttribute('selected'),
  }))
  let value = el.getAttribute('value')
  let chosen = all.find((o) => o.value == value) ??
    all.find((o) => o.selected) ?? all[0]
  return {
    kind: 'pick',
    key: keyOf(el),
    style: styleOf(el, look),
    value: chosen?.value ?? '',
    options: all.map(({ value, label }) => ({ value, label })),
    disabled: el.hasAttribute('disabled'),
    choose: (v) => {
      el.value = v
      dispatch(el, event('input'))
      dispatch(el, event('change'))
    },
  }
}

let attrsOf = (el: TElement): Record<string, string> =>
  Object.fromEntries(
    el.getAttributeNames().map((k) => [k, el.getAttribute(k) ?? '']),
  )

let shape = (el: TElement, look: Look): Shape => ({
  tag: el.localName,
  attrs: attrsOf(el),
  style: styleOf(el, look),
  shapes: elements(el).map((c) => shape(c, look)),
})

let drawing = (el: TElement, look: Look, around: Style): Drawing => ({
  kind: 'drawing',
  key: keyOf(el),
  style: { ...worn(around), ...styleOf(el, look) },
  attrs: attrsOf(el),
  shapes: elements(el).map((c) => shape(c, look)),
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
  if (WEB.has(el.localName)) {
    return {
      kind: 'web',
      key: keyOf(el),
      style: styleOf(el, look),
      tag: el.localName,
      words: el.getAttribute('aria-label') ?? el.getAttribute('title') ??
        words(el).trim(),
    }
  }
  if (el.localName == 'svg') return drawing(el, look, around)
  if (el.localName == 'img') {
    return {
      kind: 'image',
      key: keyOf(el),
      style: styleOf(el, look),
      uri: el.getAttribute('src') ?? '',
      alt: el.getAttribute('alt') ?? '',
    }
  }
  if (el.localName == 'select') return pick(el, look)
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

// What a view that threw paints: a notice that it is on the app's web page,
// with what went wrong.
let broken = (e: unknown): Web => ({
  kind: 'web',
  key: 0,
  style: {},
  tag: 'error',
  words: String((e as Error)?.message ?? e),
})

// Catches what the tree throws while rendering, so a view that breaks shows
// its notice instead of taking the host down with it.
class Kept
  extends Component<{ fell: (e: unknown) => void; children?: ComponentChild }> {
  override componentDidCatch(e: unknown) {
    this.props.fell(e)
  }
  override render() {
    return this.props.children
  }
}

/** Render a tree into the in-memory DOM and hand `drawn` its painted nodes
 * after every change, as a terminal repaints; the answer unmounts it. The
 * DOM is one per process, so one tree is mounted at a time. A tree that
 * throws while it renders paints as a {@link Web} notice saying so, and
 * `fell` hears what it threw; a pressed link no listener took is `follow`ed,
 * as a browser loads it. */
export let mount = (
  node: ComponentChild,
  look: Look,
  drawn: (painted: Node | null) => void,
  { fell = console.error, follow = () => {} }: {
    fell?: (e: unknown) => void
    follow?: (href: string) => void
  } = {},
): () => void => {
  let { root, free } = install()
  let host = root as unknown as Parameters<typeof render>[1]
  let fault: Web | null = null
  let fall = (e: unknown) => {
    fault = broken(e)
    fell(e)
    drawn(fault)
  }
  onPaint(() => drawn(fault ?? paint(root, look)))
  onNavigate(follow)
  try {
    render(h(Kept, { fell: fall }, node), host)
  } catch (e) {
    fall(e)
  }
  return () => {
    render(null, host)
    onPaint(() => {})
    onNavigate(() => {})
    free()
  }
}

export { type Colors, look } from './look.ts'
