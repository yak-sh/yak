/**
 * A text field: one line to type in, or several (`lines`), showing `value`
 * and, while it is empty, its `placeholder`; or one to pick a value in
 * (`choose`), its options its children. What typing means is the
 * caller's. `caret` is where the caret stands while the field has the
 * keyboard: a browser shows its own, and a terminal, which has no focus to
 * show it by, paints a cursor there (@yaks/tui reads it as `data-caret`).
 *
 * Once drawn, a text field owns what is typed in it. A `value` is shown when
 * it changes, as a draft synced from elsewhere does, and the caret and
 * selection move with the text around them (`moved`), so typing in the
 * middle of a line goes on where it was. A value that arrives in the middle
 * of a composition (an IME, a phone's keyboard) waits until it ends. Drawing
 * again with the same value never writes over what was typed since.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import {
  createElement as h,
  type FunctionComponent,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { Surface } from './Surface.ts'
import { el, type Props } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'

let name = 'Field'
let Input = el(Surface.Well, name)
let tagOf = (choose?: boolean, lines?: boolean) =>
  choose ? 'select' : lines ? 'textarea' : 'input'

/** What a field takes besides a part's props. */
export type FieldProps =
  & Props
  & {
    /** several lines: a textarea, where a newline can be typed */
    lines?: boolean
    /** the caret's offset into `value`, while the field has the keyboard */
    caret?: number
  }
  & (
    | { choose: true; lines?: false; as?: 'select'; placeholder?: never }
    | {
      choose?: false
      lines?: false
      type: 'file' | 'date' | 'time' | 'datetime-local'
      as?: 'input'
      placeholder?: never
    }
    | { choose?: false; placeholder: string }
  )

/** Where offset `at` in `was` stands once it reads `now`: before the one
 * span that changed it stays, after it it moves by what the span grew, and
 * inside it it goes to the span's end. */
export let moved = (was: string, now: string, at: number): number => {
  let n = Math.min(was.length, now.length)
  let a = 0
  while (a < n && was[a] == now[a]) a++
  let z = 0
  while (z < n - a && was.at(-1 - z) == now.at(-1 - z)) z++
  return at <= a
    ? at
    : at >= was.length - z
    ? at + now.length - was.length
    : now.length - z
}

type Typed = HTMLInputElement | HTMLTextAreaElement
type Ref = ((el: Typed | null) => void) | { current: Typed | null }

// `value` shown in `el`, its selection moved with the text around it. A
// textarea's newlines are \n whatever it was given, so a \r\n is no change.
let show = (el: Typed, value: string) => {
  let was = el.value
  if (was == value.replace(/\r\n?/g, '\n')) return
  let { selectionStart: from, selectionEnd: to, selectionDirection } = el
  el.value = value
  if (from == null || to == null || !el.setSelectionRange) return
  let now = el.value
  el.setSelectionRange(
    moved(was, now, from),
    moved(was, now, to),
    selectionDirection ?? undefined,
  )
}

/** A text field. */
export let Field: FunctionComponent<FieldProps> = (
  { lines, choose, caret, as, elRef, value, ...p },
) => {
  let el = useRef<Typed | null>(null)
  // the text it is to show; none for a field picked in
  let given = useRef<string | undefined>(undefined)
  // a composition is under way, and whether a value waits for its end
  let composing = useRef<false | { waits: boolean }>(false)
  given.current = !choose && typeof value == 'string' ? value : undefined
  let ref = useMemo(() => (node: Typed | null) => {
    el.current = node
    let r = elRef as Ref | undefined
    if (typeof r == 'function') r(node)
    else if (r) r.current = node
  }, [elRef])
  let shown = () => {
    let node = el.current, text = given.current
    if (!node || text == null) return
    if (composing.current) composing.current.waits = true
    else show(node, text)
  }
  useLayoutEffect(shown, [value])
  useLayoutEffect(() => {
    let node = el.current
    if (!node?.addEventListener) return
    let start = () => void (composing.current = { waits: false })
    let end = () => {
      let waited = composing.current && composing.current.waits
      composing.current = false
      if (waited) shown()
    }
    node.addEventListener('compositionstart', start)
    node.addEventListener('compositionend', end)
    return () => {
      node.removeEventListener('compositionstart', start)
      node.removeEventListener('compositionend', end)
    }
  }, [])
  return h(Input, {
    ...p,
    as: as ?? tagOf(choose, lines),
    elRef: ref,
    // Drawn, a text field is told what it already shows, so drawing it
    // again never writes over typing; `show` puts a new value in. A field
    // given none carries no `value`, so its `defaultValue` is what it shows.
    ...value !== undefined && {
      value: given.current != null && el.current ? el.current.value : value,
    },
    'data-caret': caret,
  })
}

/** An input that a person cannot type into, for hosts that build DOM nodes directly. */
export let drawNativeInput = <Node>(
  draw: (tag: string, props: Record<string, unknown>) => Node,
  props:
    & { type: 'checkbox' | 'radio' | 'file' | 'hidden' }
    & Record<string, unknown>,
): Node => draw('input', props)

/** A field for hosts that build DOM nodes directly. */
export let drawField = <Node, Child>(
  draw: (
    tag: string,
    props: Record<string, unknown>,
    ...children: Child[]
  ) => Node,
  { lines, choose, className, class: named, ...props }: FieldProps,
  ...children: Child[]
): Node => {
  let extra = [className, named].filter(Boolean).join(' ')
  return draw(
    tagOf(choose, lines),
    {
      ...props,
      class: extra ? `Surface_Well ${name} ${extra}` : `Surface_Well ${name}`,
    },
    ...children,
  )
}

/** What it is, in a line. */
export let description =
  'A text field: one line to type in, or several, or one to pick in.'

/** Typed text is ink, whatever it sits in. */
export let sheet = (c: Colors): Sheet => ({
  Field: { fg: c.text, bg: c.surface, border: c.border },
  'Field-bare': { fg: c.text },
})

/** A field on a phone types in the text's ink. */
export let native = (c: Colors): Native => ({
  Field: { color: c.text },
  'Field-bare': { color: c.text },
})

/** Empty, typed in, typed in with the caret shown, picked in, and bare. */
export let specimens = (): Specimen[] => [
  ['Field, empty', h(Field, { value: '', placeholder: 'filter…' })],
  [
    'Field',
    h(Field, { placeholder: 'Filter by status…', value: '.task.status=open' }),
  ],
  [
    'Field, caret',
    h(Field, {
      placeholder: 'Filter by status…',
      value: '.task.status=open',
      caret: 12,
    }),
  ],
  [
    'Field, choose',
    h(
      Field,
      { choose: true, value: 'open' },
      h('option', { value: 'open' }, 'open'),
      h('option', { value: 'done' }, 'done'),
    ),
  ],
  [
    'Field-bare, lines',
    h(Field, {
      mod: 'bare',
      lines: true,
      placeholder: 'Write a note…',
      value: 'set',
    }),
  ],
]
