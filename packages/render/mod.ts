/**
 * @yaks/render owns renderer selection and the verbs a bundle offers. A view
 * walks role-rightmost (Board.List.Tile → List.Tile → Tile), applying an alias
 * at every step; within a step, more query clauses win and registration order
 * breaks ties. A true catch-all scores 0.5. No host is imported here.
 *
 * Editors use this same registry. Pass {comp, col} to resolve and it matches
 * a bundle-shaped projection of that column's declared schema instead of the
 * entity: parse('.column.type=string') selects a string editor. The renderer
 * still receives the original bundle and that context, so it knows the value
 * and where a patch belongs. Column queries and entity queries describe
 * different subjects; register them under appropriate views. See column.ts
 * for the four queryable schema fields. editors(vocab) supplies the portable
 * Edit family; properties(vocab) lays out a component through that registry.
 *
 * A missing view returns undefined unless a matching JSON view is registered.
 * An unnamed request considers the configured views (all by default).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { parse } from '@yaks/query'
 * import { loadVocab } from '@yaks/vocab'
 * import { define, resolve, type H } from '@yaks/render'
 *
 * let vocab = loadVocab([{ $defs: { doc: {
 *   type: 'object', properties: { title: { type: 'string' } },
 * } } }])
 * let bundle = { entity: { eid: 'a' }, doc: { title: 'A page' } }
 * let registry = define([{
 *   view: 'Tile', match: parse('.doc'),
 *   render: (b, h) => h('h2', null, String((b.doc as {title: string}).title)),
 * }])
 * let calls: unknown[] = []
 * let h: H<number> = (tag, props, ...children) =>
 *   calls.push({ tag, props, children })
 * let renderer = resolve(registry, bundle, 'Board.Tile', vocab)!
 * assertEquals(renderer.render(bundle, h, {}), 1)
 * assertEquals(calls, [{ tag: 'h2', props: null, children: ['A page'] }])
 * ```
 *
 * @module
 */

import { type Bundle, filter } from '@yaks/match'
import type { Query } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { column, columnVocab } from './column.ts'
import type {
  Action,
  Context,
  Contributor,
  Options,
  Registration,
  Registry,
  Renderer,
  Selection,
} from './types.ts'

export { edit, type EditOptions } from './edit.ts'

export type { Bundle } from '@yaks/match'
export type { Query } from '@yaks/query'
export type {
  Action,
  Child,
  Context,
  Contributor,
  H,
  Options,
  Patch,
  Registration,
  Registry,
  RenderContext,
  Renderer,
  Selection,
} from './types.ts'

/** Build an independent registry; earlier registrations win equal scores. */
export function define<R extends Renderer = Renderer, A = Action, E = Bundle>(
  renderers: readonly R[],
  options?: Options<NoInfer<A>, E>,
): Registry<R & Renderer, A, E>
export function define<R extends Registration, A = Action, E = Bundle>(
  renderers: readonly R[],
  options?: Options<NoInfer<A>, E>,
): Registry<R, A, E>
export function define<R extends Registration, A = Action, E = Bundle>(
  renderers: readonly R[],
  options: Options<NoInfer<A>, E> = {},
): Registry<R, A, E> {
  return { ...options, renderers: [...renderers] }
}

/** Prepend a host overlay to this registry; earlier rows win equal scores. */
export let extend = <R extends Registration>(
  registry: Selection<R>,
  renderers: readonly R[],
): void => {
  registry.renderers = [...renderers, ...registry.renderers]
}

let matches = (match: Registration['match'], bundle: Bundle, vocab: Vocab) =>
  match === true || filter(match, vocab)(bundle)

let best = <R extends Registration>(
  pool: readonly R[],
  bundle: Bundle,
  vocab: Vocab,
): R | undefined => {
  let top: R | undefined
  let max = -Infinity
  for (let r of pool) {
    if (!matches(r.match, bundle, vocab)) continue
    // Shift the whole query tier so an empty conjunction beats the catch-all
    // while still ranking below every query with clauses.
    let score = r.match === true ? 0.5 : 1 + r.match.clauses.length
    if (score > max) {
      max = score
      top = r
    }
  }
  return top
}

/**
 * Resolve the closest view, then its most specific renderer. Aliasing changes
 * the remaining walk, as for a stored name renamed to another qualified view.
 * Cyclic alias walks stop before visiting a name twice.
 */
export let resolve = <R extends Registration>(
  registry: Selection<R>,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context = {},
): R | undefined => {
  if (ctx.col != null) {
    bundle = column(vocab, ctx)
    vocab = columnVocab
  }
  let { renderers, aliases = {}, views } = registry
  let pick = (name: string) =>
    best(renderers.filter((r) => r.view == name), bundle, vocab)
  if (!view) {
    return best(
      renderers.filter((r) => !views || views.includes(r.view)),
      bundle,
      vocab,
    ) ?? pick('JSON')
  }
  let seen = new Set<string>()
  for (let v = view; v && !seen.has(v); v = v.replace(/^[^.]+\.?/, '')) {
    seen.add(v)
    v = Object.hasOwn(aliases, v) ? aliases[v] : v
    let found = pick(v)
    if (found) return found
  }
  return pick('JSON')
}

/** Exact, matching tab views in configured order, without JSON fallback. */
export let applicable = <R extends Registration>(
  registry: Selection<R>,
  bundle: Bundle,
  vocab: Vocab,
  ctx: Context = {},
): string[] => {
  if (ctx.col != null) {
    bundle = column(vocab, ctx)
    vocab = columnVocab
  }
  let views = registry.views ??
    [...new Set(registry.renderers.map((r) => r.view))]
  return views.filter((view) =>
    registry.renderers.some((r) =>
      r.view == view && matches(r.match, bundle, vocab)
    )
  )
}

/**
 * All matching contributions, preserving duplicates and registration order.
 * Static offerings are keyed by worn component; dynamic contributors receive
 * the source supplied by the caller, while their queries read the bundle.
 * Conditions use the supplied vocabulary or define's default; run is never called.
 */
export function actions<R extends Registration, A>(
  registry: Registry<R, A>,
  bundle: Bundle,
  vocab?: Vocab,
): A[]
export function actions<R extends Registration, A, E>(
  registry: Registry<R, A, E>,
  bundle: Bundle,
  vocab: Vocab | undefined,
  source: E,
): A[]
export function actions<R extends Registration, A, E>(
  registry: Registry<R, A, E>,
  bundle: Bundle,
  vocab: Vocab | undefined = registry.vocab,
  source?: E,
): A[] {
  let test = (match: Registration['match']) => {
    if (match === true) return true
    if (!vocab) throw new Error('action conditions need a vocabulary')
    return matches(match, bundle, vocab)
  }
  let offered: readonly (A & { when?: Query })[]
  if (Array.isArray(registry.actions)) {
    // The three-argument overload accepts Bundle sources only.
    let input = (source === undefined ? bundle : source) as E
    offered = (registry.actions as readonly Contributor<A, E>[])
      .filter((c) => test(c.match)).flatMap((c) => c.acts(input))
  } else {
    offered = Object.entries(registry.actions ?? {}).flatMap(([comp, acts]) =>
      !comp.startsWith('$') && bundle[comp] && typeof bundle[comp] == 'object'
        ? acts
        : []
    )
  }
  return offered.filter((action) => !action.when || test(action.when))
}
