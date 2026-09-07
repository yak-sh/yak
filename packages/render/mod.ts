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
 * for the four queryable schema fields. No editor implementation lives here.
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
import type { Vocab } from '@yaks/vocab'
import { column, columnVocab } from './column.ts'
import type { Action, Context, Options, Registry, Renderer } from './types.ts'

export type { Bundle } from '@yaks/match'
export type { Query } from '@yaks/query'
export type {
  Action,
  Child,
  Context,
  H,
  Options,
  Patch,
  Registry,
  Renderer,
} from './types.ts'

/** Build an independent registry; earlier registrations win equal scores. */
export let define = (
  renderers: readonly Renderer[],
  options: Options = {},
): Registry => ({ ...options, renderers: [...renderers] })

let best = (
  pool: readonly Renderer[],
  bundle: Bundle,
  vocab: Vocab,
): Renderer | undefined => {
  let top: Renderer | undefined
  let max = -Infinity
  for (let r of pool) {
    if (r.match !== true && !filter(r.match, vocab)(bundle)) continue
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
export let resolve = (
  registry: Registry,
  bundle: Bundle,
  view: string | undefined,
  vocab: Vocab,
  ctx: Context = {},
): Renderer | undefined => {
  if (ctx.comp != null || ctx.col != null) {
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

/**
 * All verbs contributed by components the bundle wears, in registration order.
 * Duplicate names survive, as in the reference contributor union. Conditions
 * use the supplied vocabulary or the one given to define; run is never called.
 */
export let actions = (
  registry: Registry,
  bundle: Bundle,
  vocab: Vocab | undefined = registry.vocab,
): Action[] =>
  Object.entries(registry.actions ?? {}).flatMap(([comp, offered]) => {
    if (
      comp.startsWith('$') || !bundle[comp] || typeof bundle[comp] != 'object'
    ) {
      return []
    }
    return offered.filter((action) => {
      if (!action.when) return true
      if (!vocab) throw new Error('action conditions need a vocabulary')
      return filter(action.when, vocab)(bundle)
    })
  })
