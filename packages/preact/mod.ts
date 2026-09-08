/**
 * @yaks/preact owns the browser door for portable renderers. render hands
 * Preact's hyperscript to the selected renderer; entity binds a registry,
 * vocabulary and store into an <Entity eid view/> component. The store remains
 * a function, with an optional per-entity subscription supplied beside it.
 * Missing bundles or unmatched views render nothing. Subscriptions belong to
 * the mounted component and are released when its eid changes or it unmounts.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { define } from '@yaks/render'
 * import { loadVocab } from '@yaks/vocab'
 * import { render } from '@yaks/preact'
 *
 * let registry = define([{
 *   view: 'Tile', match: true,
 *   render: (b, h) => h('p', null, b.entity.eid),
 * }])
 * let node = render(registry, {entity: {eid: 'a'}}, 'Tile', loadVocab([]))!
 * assertEquals(node.type, 'p')
 * assertEquals(node.props.children, ['a'])
 * ```
 *
 * @module
 */

import {
  type ComponentChildren,
  type FunctionComponent,
  h,
  type VNode,
} from 'preact'
import { useLayoutEffect, useState } from 'preact/hooks'
import {
  type Action,
  type Bundle,
  type Context,
  type H,
  type Patch,
  type Registration,
  type RenderContext,
  type Renderer,
  resolve,
  type Selection,
} from '@yaks/render'
import type { Vocab } from '@yaks/vocab'

/** A native component; the host mounts it so Preact owns its hooks and identity. */
export type ComponentRenderer<E = Bundle> = Registration & {
  Render: FunctionComponent<Context & Events & { e: E }>
}

/** The application applies a successful edit and may display rejected input. */
export type Events = {
  onPatch?: (patch: Patch, bundle: Bundle) => void
  onError?: (error: unknown, bundle: Bundle) => void
}

/** Portable trees and native components share the same selection machinery. */
type HostRegistry<E = Bundle> = Selection<Renderer | ComponentRenderer<E>>
type Node<E = Bundle> =
  | VNode<Record<string, unknown>>
  | VNode<Context & { e: E }>

/** A synchronous read; absence is allowed so a subscription can announce arrival. */
export type Store = (eid: string) => Bundle | undefined

/** Watch one entity and return the cleanup for that listener. */
export type Subscribe = (eid: string, notify: () => void) => () => void

/** The values bound once when an application creates its Entity component. */
export type Options = {
  registry: HostRegistry
  vocab: Vocab
  store: Store
  subscribe?: Subscribe
}

/** An entity address and view; all remaining props are renderer context. */
export type EntityProps = Context & Events & { eid: string; view?: string }

let action = (value: unknown): value is Action =>
  value != null && typeof value == 'object' && 'run' in value &&
  typeof value.run == 'function'

type Control = {
  type?: string
  checked?: boolean
  value?: string
  setCustomValidity?: (message: string) => void
  reportValidity?: () => boolean
}

let change = (act: Action, bundle: Bundle, ctx: Events) => (event: Event) => {
  let control = event.currentTarget as Control | null
  let input = control?.type == 'checkbox' ? control.checked : control?.value
  let patch: Patch
  try {
    patch = act.run(bundle, input)
  } catch (error) {
    control?.setCustomValidity?.(
      error instanceof Error ? error.message : String(error),
    )
    control?.reportValidity?.()
    ctx.onError?.(error, bundle)
    return
  }
  control?.setCustomValidity?.('')
  ctx.onPatch?.(patch, bundle)
}

// The shared child contract admits readonly arrays; Preact reads the same
// structure but declares mutable arrays. Keep that type adaptation at the host.
let hyperscript = <E>(
  bundle: Bundle,
  ctx: Events,
): H<Node<E>> =>
(tag, props, ...children) => {
  if (action(props?.onChange)) {
    props = { ...props, onChange: change(props.onChange, bundle, ctx) }
  }
  return children.length
    ? h<Record<string, unknown>>(tag, props, children as ComponentChildren)
    : h<Record<string, unknown>>(tag, props)
}

/**
 * Resolve a view and build a Preact node. Native components are passed to h,
 * never invoked directly. Native props default to {e: bundle, ...ctx}; callers
 * with another entity shape supply their typed props as the sixth argument.
 */
export function render(
  registry: Selection<Renderer>,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx?: Context & Events,
): VNode<Record<string, unknown>> | null
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
  return renderer.render(bundle, hyperscript(bundle, ctx), context)
}

/**
 * Bind the application once: `let Entity = entity({registry, vocab, store,
 * subscribe})`, then mount `<Entity eid='a' view='Tile'/>` through Preact.
 * A notification re-reads the store even if it mutated a bundle in place.
 */
export let entity = (
  { registry, vocab, store, subscribe }: Options,
): FunctionComponent<EntityProps> =>
({ eid, view, ...ctx }) => {
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
  return bundle ? render(registry, bundle, view, vocab, ctx) : null
}
