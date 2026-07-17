import { type ComponentChildren, h } from 'preact'
import { signal } from '@preact/signals'

// The one place that speaks our CSS naming (Block, Block_Element,
// Block-modifier). el('span', 'Dot') bakes the class into a component; its
// `mod` prop appends modifiers: <Pip mod='wip' /> → class="Dot Dot-wip".
// `class` still merges extras, `elRef` reaches the DOM node (function
// components don't forward `ref`), and everything else — style, handlers,
// draggable, type — flows through.

type Mod = string | false | null | undefined

export let el = (tag: string, base: string) =>
(
  { mod, class: extra, elRef, children, ...props }: {
    mod?: Mod | Mod[]
    class?: string
    elRef?: unknown
    children?: ComponentChildren
    [x: string]: unknown
  },
) =>
  h(tag, {
    ...props,
    ref: elRef,
    class: [
      base,
      ...(Array.isArray(mod) ? mod : [mod]).filter(Boolean).map((m) =>
        `${base}-${m}`
      ),
      extra,
    ].filter(Boolean).join(' '),
  }, children)

// Take the keyboard on mount: <Field elRef={focus} />. The `autofocus`
// attribute can't do this job — the document's autofocus-processed flag
// fires once per page, so only the FIRST editor a page ever opened would
// take focus. Module-level (not an inline arrow) so preact sees one
// stable ref and calls it on mount, not on every render.
export let focus = (n: unknown) => (n as HTMLElement | null)?.focus()

// A whole element family hung on its Block: block('section', 'Card',
// { Tabs: 'header', Scroll: 'div' }) renders section.Card, and carries
// <C.Tabs> → header.Card_Tabs — the key IS the element name, the value its
// tag. `let { Tabs, Scroll } = C` uses them bare.
export let block = <K extends string>(
  tag: string,
  base: string,
  kids: Record<K, string>,
) =>
  Object.assign(
    el(tag, base),
    Object.fromEntries(
      (Object.entries(kids) as [K, string][])
        .map(([k, t]) => [k, el(t, `${base}_${k}`)]),
    ) as Record<K, ReturnType<typeof el>>,
  )

// Relative time for humans — '5 minutes ago' — off a minute tick, so an
// open card doesn't fossilize at the age it rendered. Pair with
// title={pretty(iso)} for the full stamp on hover.
let tick = signal(Date.now())
if (globalThis.document) setInterval(() => (tick.value = Date.now()), 60_000)
let SIZES: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
let rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export let ago = (iso?: string | null) => {
  if (!iso) return ''
  let s = (tick.value - Date.parse(iso)) / 1000
  for (let [unit, size] of SIZES) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(-s / size), unit)
  }
  return 'just now'
}
export let pretty = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : ''

let StampEl = el('span', 'Stamp')

// An entity's age, said the human way: 'created 5 minutes ago', plus
// 'edited …' only when modified_at actually moved past its birth. Full
// stamps ride the tooltips. Drop it in any view's meta line.
export let Stamp = (
  { e }: { e: { created_at?: string; modified_at?: string } },
) => {
  if (!e.created_at) return null
  let edited = e.modified_at && e.modified_at != e.created_at
  return (
    <StampEl>
      <span title={pretty(e.created_at)}>{ago(e.created_at)}</span>
      {edited && (
        <span title={pretty(e.modified_at)}>· edited {ago(e.modified_at)}</span>
      )}
    </StampEl>
  )
}
