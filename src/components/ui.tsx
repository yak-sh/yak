import { type ComponentChildren, createContext, h } from 'preact'
import { useContext } from 'preact/hooks'
import { signal } from '@preact/signals'

// The one place that speaks our CSS naming (Block, Block_Element,
// Block-modifier). el('span', 'Dot') bakes the class into a component; its
// `mod` prop appends modifiers: <Pip mod='wip' /> → class="Dot Dot-wip".
// `class` still merges extras, `elRef` reaches the DOM node (function
// components don't forward `ref`), `href` makes the element a link (the
// Surround stack below), and everything else — style, handlers, draggable,
// type — flows through.

type Mod = string | false | null | undefined

// The ambient link: an el with href provides it, descendants read it to
// dedupe or demote their own.
export let Surround = createContext<{ href?: string }>({})

// The link decision, pure: an href with no surrounding link becomes an
// <a> — the original tag joins the class list (class="Card_Cell div") so
// its default styles still bind. The SAME href inside that link drops (a
// cell links the entity; the title inside would link the same place). A
// DIFFERENT href keeps its tag and demotes to a JS link — nested <a> is
// invalid HTML.
export let anchor = (
  tag: string,
  href?: string,
  outer?: string,
): { tag: string; cls?: string; href?: string; demote?: string } =>
  !href || href == outer
    ? { tag }
    : outer
    ? { tag, demote: href }
    : { tag: 'a', cls: tag, href }

// Demoted links click through nav's contract, but nav.tsx builds on ui.tsx
// at module init (block, copy) — importing back would let module load order
// decide whether the cycle lands in TDZ. The dumb layer stays app-import-
// free: nav.tsx fills this slot at its own module init.
let follow = (_href: string): Record<string, unknown> => ({})
export let setFollow = (f: typeof follow) => (follow = f)

export let el = (tag: string, base: string) =>
(
  { mod, class: extra, elRef, children, href, ...props }: {
    mod?: Mod | Mod[]
    class?: string
    elRef?: unknown
    href?: string
    children?: ComponentChildren
    [x: string]: unknown
  },
) => {
  let a = anchor(tag, href, useContext(Surround).href)
  let node = h(a.tag, {
    ...props,
    ...(a.href && { href: a.href }),
    // The demoted form loses native new-tab clicks and the browser link
    // menu — acceptable for nested controls.
    ...(a.demote &&
      { role: 'link', tabIndex: 0, ...follow(a.demote) }),
    ref: elRef,
    class: [
      base,
      ...(Array.isArray(mod) ? mod : [mod]).filter(Boolean).map((m) =>
        `${base}-${m}`
      ),
      a.cls,
      extra,
    ].filter(Boolean).join(' '),
  }, children)
  return a.href ? h(Surround.Provider, { value: { href: a.href } }, node) : node
}

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

// The id chip atom: one T-123 token, paint only (the `.Id` block). A span,
// not an anchor — a caller that wants it to LINK spreads href + handlers and
// the el stack promotes it to <a>; inside a surrounding link it stays a span
// (nested <a> is the parser trap the Surround stack exists to dodge). ui.tsx
// knows no entities, so idOf / retired / linkProps stay with the smart
// callers (views/Inline.tsx Id).
export let Chip = el('span', 'Id')

// Relative time for humans — '5 minutes ago' — off a minute tick, so an
// open card doesn't fossilize at the age it rendered. Pair with
// data-tip={pretty(iso)} for the full stamp on hover.
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
export let ago = (iso?: string | null, now = tick.value) => {
  if (!iso) return ''
  let s = (now - Date.parse(iso)) / 1000
  for (let [unit, size] of SIZES) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(-s / size), unit)
  }
  return 'just now'
}
export let pretty = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : ''

// Copy text from a click handler. navigator.clipboard is gated to secure
// contexts and the tailnet page is plain http (the uuid() story again) —
// so fall back to the selection dance when the modern door is shut.
export let copy = (text: string) => {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {})
    return
  }
  let t = document.createElement('textarea')
  t.value = text
  t.style.position = 'fixed'
  t.style.opacity = '0'
  document.body.appendChild(t)
  t.select()
  document.execCommand('copy')
  t.remove()
}

let StampEl = el('span', 'Stamp')

// An age, said the human way. An entity says when it was created and,
// when present, edited; `at` names any other graph timestamp. Full
// stamps ride the tooltips.
export let Stamp = (
  { e, at, label }: {
    e?: { created?: { at?: string }; updated?: { at?: string } }
    at?: string | null
    label?: string
  },
) => {
  let born = at ?? e?.created?.at
  if (!born) return null
  // `updated` presence is the edited signal (T-6670), but belongs only
  // to the entity-age form.
  let edited = at == null ? e?.updated?.at : undefined
  return (
    <StampEl>
      <span data-tip={pretty(born)}>
        {label && `${label} `}
        {ago(born)}
      </span>
      {edited && <span data-tip={pretty(edited)}>· edited {ago(edited)}</span>}
    </StampEl>
  )
}
