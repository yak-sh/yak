import { type ComponentChildren, h } from 'preact'

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
