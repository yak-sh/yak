// Resolve places against the catalog only when its bytes match the failing
// commit. One catalog read keeps a module and its exports in the same snapshot.

import { type Bundle, type Comp, identityEid } from '@yaks/graph'

export type Place = { path: string; function?: string; line?: number }
export type Catalog = { get: (ids: string[]) => Promise<Bundle[]> }
export type Resolved = { app: boolean; module?: string; symbol?: string }
let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] && typeof row[name] == 'object' ? row[name] as Comp : {}
let appPath = (path: string, blobs: Map<string, string>) =>
  blobs.has(path) && !/(^|\/)(vendor|node_modules)\//.test(path)

export let resolveFrames = async (
  catalog: Catalog,
  repository: string,
  blobs: Map<string, string>,
  places: Place[],
): Promise<Resolved[]> => {
  let ids = places.map((p) => identityEid('file', [p.path, repository]))
  let symbols = places.map((p, i) =>
    p.function ? identityEid('symbol', [ids[i], p.function]) : ''
  )
  let requested = places.flatMap((p, i) =>
    appPath(p.path, blobs) ? [ids[i], ...symbols[i] ? [symbols[i]] : []] : []
  )
  let known = new Map(
    (requested.length ? await catalog.get([...new Set(requested)]) : []).map((
      row,
    ) => [row.entity.eid, row]),
  )
  return places.map((p, i) => {
    let app = appPath(p.path, blobs)
    let row = known.get(ids[i])
    let file = comp(row, 'file')
    if (
      !app || file.path != p.path || file.repository != repository ||
      comp(row, 'module').blob != blobs.get(p.path)
    ) return { app }
    let symbol = comp(known.get(symbols[i]), 'symbol')
    return {
      app,
      module: ids[i],
      ...symbol.module == ids[i] && symbol.name == p.function &&
          ['function', 'variable', 'class'].includes(String(symbol.kind)) &&
          typeof symbol.line == 'number' && symbol.line > 0 &&
          (p.line == null || symbol.line <= p.line)
        ? { symbol: symbols[i] }
        : {},
    }
  })
}
