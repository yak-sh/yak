import { type ComponentChildren, h } from 'preact'

// The one place that speaks our CSS naming (Block, Block_Element,
// Block-modifier). el('span', 'Dot') bakes the class into a component; its
// `mod` prop appends modifiers: <Pip mod='wip' /> → class="Dot Dot-wip".
// `class` still merges extras, `elRef` reaches the DOM node (function
// components don't forward `ref`), and everything else — style, handlers,
// draggable, type — flows through. UI composites (<Card title=…>) build on
// these instead of raw tags.

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
