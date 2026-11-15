// Where an app store's own plugins keep their facets in this package: each
// `yak/*` name a store config lists (./config.ts), and the export of this
// package each of its facets is. A host resolves those names through this one
// table and adds the facets only it can give (yaks.app's Cloudflare effects,
// workers/yak config.ts `domains`); a facet neither names is skipped.
import type { FacetName, Facets as HostFacets, Load } from '@yaks/host'

/** A `yak/*` plugin's facets, each the specifier of the module it is. */
export type Specifiers = Partial<Record<FacetName, string>>

let at = (name: string): string => `@yaks/platform/${name}`

export let facets: Record<string, Specifiers> = {
  'yak/app': { vocab: at('app-vocab'), graph: at('app-graph') },
  'yak/directory': { vocab: at('directory-vocab') },
  'yak/trash': { vocab: at('trash-vocab'), graph: at('trash-graph') },
  'yak/meter': { vocab: at('meter-vocab'), graph: at('meter-graph') },
  'yak/refusals': { vocab: at('refusals-vocab') },
  'yak/lenses': { graph: at('lenses-graph') },
  'yak/lower': { graph: at('lower-graph') },
  'yak/describe': { graph: at('describe-graph') },
  'yak/weigh': { graph: at('weigh-graph') },
  'yak/rouse': { graph: at('rouse-graph') },
  'yak/embed': { graph: at('embed-graph') },
  'yak/lexicon': { graph: at('lexicon-graph') },
  'yak/log': { graph: at('log-graph') },
  'yak/admit': { graph: at('admit-graph') },
  'yak/attribution': { vocab: at('attribution-vocab') },
  'yak/models': { vocab: at('models-vocab') },
  'yak/git': { graph: at('git-graph') },
  'yak/wrap': { graph: at('wrap-graph') },
  'yak/remake': { graph: at('remake-graph') },
  'yak/kills': { graph: at('kills-graph') },
  'yak/files': { routes: at('files-routes') },
  'yak/client': { routes: at('client-routes') },
}

/** `facets` with a host's own beside them, plugin by plugin. */
/// beside({ 'yak/x': { effects: './x.ts' } })['yak/x'] -> { effects: './x.ts' }
/// beside({ 'yak/app': { effects: './a.ts' } })['yak/app'].effects -> './a.ts'
/// beside({ 'yak/app': { effects: './a.ts' } })['yak/app'].vocab -> '@yaks/platform/app-vocab'
export let beside = <O extends Record<string, Record<string, string>>>(
  own: O,
): Record<string, Record<string, string>> =>
  Object.fromEntries(
    [...new Set([...Object.keys(facets), ...Object.keys(own)])].map((
      name,
    ) => [name, { ...facets[name], ...own[name] } as Record<string, string>]),
  )

/** A host's `load`, each `yak/*` facet resolved through {@link facets} to the
 * export of this package it is, and one the table does not name absent;
 * every other plugin's resolved by `load` itself. A table entry is a package
 * subpath, so `load` is asked for it as it is asked for any plugin's. */
export let resolved = (load: Load): Load => {
  let homed = (plugin: string, name: FacetName): [string, FacetName] | null => {
    if (!plugin.startsWith('yak/')) return [plugin, name]
    let spec = facets[plugin]?.[name]
    if (!spec) return null
    let cut = spec.indexOf('/', spec.indexOf('/') + 1)
    return [spec.slice(0, cut), spec.slice(cut + 1) as FacetName]
  }
  return Object.assign(
    <F extends FacetName>(plugin: string, name: F) => {
      let to = homed(plugin, name)
      return to
        ? load(...to) as Promise<HostFacets[F] | null>
        : Promise.resolve(null)
    },
    {
      together: load.together &&
        ((requests: readonly (readonly [string, FacetName])[]) =>
          load.together!(requests.flatMap(([p, n]) => {
            let to = homed(p, n)
            return to ? [to] : []
          }))),
    },
  )
}
