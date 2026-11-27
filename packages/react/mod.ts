/** React bindings for portable and component renderers. @module */

import {
  type Context as Provided,
  createContext,
  createElement as h,
  type FunctionComponent,
  type ReactElement,
  useContext,
  useLayoutEffect,
  useState,
} from 'react'
import {
  type Bundle,
  type Child,
  type Context,
  type H,
  type Registration,
  type RenderContext,
  type Renderer,
  rendering,
  resolve,
  type Selection,
} from '@yaks/render'
import {
  committed,
  type EntityProps,
  type Events,
  type Store,
  type Subscribe,
} from '@yaks/render/component'
export type {
  EntityProps,
  Events,
  Store,
  Subscribe,
} from '@yaks/render/component'
import type { Vocab } from '@yaks/vocab'

/** A native component; the host mounts it so React owns its hooks and identity. */
export type ComponentRenderer<E = Bundle> = Registration & {
  Render: FunctionComponent<Context & Events & { e: E }>
}

/** Portable trees and native components share the same selection machinery. */
export type HostRegistry<E = Bundle> = Selection<
  Renderer | ComponentRenderer<E>
>
type Node<E = Bundle> =
  | ReactElement<Record<string, unknown>>
  | ReactElement<Context & Events & { e: E }>

/** The values bound once when an application creates its Entity component. */
export type Options = {
  registry: HostRegistry
  vocab: Vocab
  store: Store
  subscribe?: Subscribe
}

let childrenOf = <E>(children: readonly Child<Node<E>>[]): Node<E>[] =>
  (children as unknown[]).flat(Infinity) as Node<E>[]

let hyperscript = <E>(
  bundle: Bundle,
  ctx: Events,
): H<Node<E>> =>
(tag, props, ...children) => {
  let { class: named, onDblClick, ...attrs } = props ?? {}
  let control = committed(attrs, bundle, ctx)
  if (
    control !== attrs && control &&
    (tag == 'input' || tag == 'textarea' || tag == 'select')
  ) {
    let { value, checked, ...uncontrolled } = control
    control = {
      ...uncontrolled,
      ...value !== undefined && { defaultValue: value },
      ...checked !== undefined && { defaultChecked: checked },
    }
  }
  props = {
    ...control,
    className: attrs.className ?? named,
    onDoubleClick: attrs.onDoubleClick ?? onDblClick,
  }
  return h<Record<string, unknown>>(tag, props, ...childrenOf(children))
}

/**
 * Resolve a view and build a React node. Native components are passed to h,
 * never invoked directly. Native props default to {e: bundle, ...ctx}; callers
 * with another entity shape supply their typed props as the sixth argument.
 */
export function render(
  registry: Selection<Renderer>,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx?: Context & Events,
): ReactElement<Record<string, unknown>> | null
export function render(
  registry: HostRegistry,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx?: Context & Events,
): Node | null
export function render<E>(
  registry: HostRegistry<E>,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context & Events,
  props: Context & { e: E },
): Node<E> | null
export function render<E>(
  registry: HostRegistry<E>,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context & Events = {},
  props?: Context & { e: E },
): Node<E> | null {
  let renderer = resolve(registry, bundle, view, vocab, ctx)
  if (!renderer) return null
  return renderSelected(registry, renderer, bundle, vocab, ctx, props)
}

/** Build the node for a renderer the host has already selected. */
export let renderSelected = <E>(
  registry: HostRegistry<E>,
  renderer: Renderer | ComponentRenderer<E>,
  bundle: Bundle,
  vocab: Vocab,
  ctx: Context & Events,
  props?: Context & { e: E },
): Node<E> | null => {
  let context: RenderContext<Node<E>> & Events = {
    ...ctx,
    render: (view, overrides) => {
      let next = { ...ctx, ...overrides }
      return render(
        registry,
        bundle,
        view,
        vocab,
        next,
        { ...props, ...next, e: props ? props.e : bundle as E },
      )
    },
  }
  if ('Render' in renderer) {
    // Without explicit props the public overload requires E to be Bundle.
    return h(
      renderer.Render,
      {
        ...context,
        ...props,
        render: context.render,
        e: props ? props.e : bundle as E,
      },
    )
  }
  return rendering(renderer, context)?.(bundle, hyperscript(bundle, ctx), {
    ...context,
    vocab,
  }) ?? null
}

/** The vocabulary the host has most recently merged into its page graph. */
export let Vocabulary: Provided<Vocab | undefined> = createContext<
  Vocab | undefined
>(undefined)

/** The registry selected by the page host for mounted entities. */
export let Registry: Provided<HostRegistry | undefined> = createContext<
  HostRegistry | undefined
>(undefined)

/**
 * Bind the application once: `let Entity = entity({registry, vocab, store,
 * subscribe})`, then mount `<Entity eid='a' view='Tile'/>` through React.
 * A notification re-reads the store even if it mutated a bundle in place.
 */
export let entity = (
  { registry, vocab, store, subscribe }: Options,
): FunctionComponent<EntityProps> =>
({ eid, view, ...ctx }) => {
  let now = useContext(Registry) ?? registry
  let words = useContext(Vocabulary) ?? vocab
  let [, revision] = useState(0)
  let refresh = () => revision((n) => n + 1)
  useLayoutEffect(() => {
    if (!subscribe) return
    let active = true
    let off = subscribe(eid, () => {
      if (active) refresh()
    })
    // A store may move between the render read and subscribing, including
    // mutating the same object. Re-read once after the listener is installed.
    refresh()
    return () => {
      active = false
      off()
    }
  }, [eid])
  let bundle = store(eid)
  if (!bundle) return null
  return render(now, bundle, view, words, ctx)
}
