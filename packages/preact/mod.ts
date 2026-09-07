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
  type Bundle,
  type Context,
  type H,
  type Registry,
  resolve,
} from '@yaks/render'
import type { Vocab } from '@yaks/vocab'

/** A synchronous read; absence is allowed so a subscription can announce arrival. */
export type Store = (eid: string) => Bundle | undefined

/** Watch one entity and return the cleanup for that listener. */
export type Subscribe = (eid: string, notify: () => void) => () => void

/** The values bound once when an application creates its Entity component. */
export type Options = {
  registry: Registry
  vocab: Vocab
  store: Store
  subscribe?: Subscribe
}

/** An entity address and view; all remaining props are renderer context. */
export type EntityProps = Context & { eid: string; view?: string }

// The shared child contract admits readonly arrays; Preact reads the same
// structure but declares mutable arrays. Keep that type adaptation at the host.
let hyperscript: H<VNode<Record<string, unknown>>> = (
  tag,
  props,
  ...children
) => h<Record<string, unknown>>(tag, props, children as ComponentChildren)

/** Resolve a portable view and build a Preact node, without mounting it. */
export let render = (
  registry: Registry,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context = {},
): VNode<Record<string, unknown>> | null =>
  resolve(registry, bundle, view, vocab, ctx)?.render(
    bundle,
    hyperscript,
    ctx,
  ) ?? null

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
