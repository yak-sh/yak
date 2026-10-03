// The platform's lens wiring: the page's kept deploy decides what it speaks;
// the store keeps the newest chain when its code is rolled back.
import { compile, lensesIn, versions } from '@yaks/lens'
import { type Bundle, type Comp, type ReadOpts, Refused } from '@yaks/graph'
import { and, every, never, or, present } from '@yaks/query'
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import type { App, Directory, Space } from './directory.ts'
import { storeName } from './directory.ts'
import type { Objects } from '@yaks/blob'
import { pins } from './versions.ts'
import { prefixOf } from './files.ts'
import type { Mark, Rule } from './mover.ts'

export let declaredLenses = (doc: VocabDoc): boolean =>
  Object.values(doc.$defs ?? {}).some((s) => s.lens === true)

export let lensDocAt = (name: string, doc: VocabDoc): VocabDoc => ({
  ...doc,
  package: `@app/${name}`,
})

/** The directory keeps the newest store vocabulary while code rolls back. */
export let latestSpeaks = (
  name: string,
  doc: VocabDoc,
  was?: Record<string, number>,
): Record<string, number> | undefined => {
  if (!was && !declaredLenses(doc)) return undefined
  let next = versions([lensDocAt(name, doc)])
  return Object.fromEntries(
    [...new Set([...Object.keys(was ?? {}), ...Object.keys(next)])].map((
      pkg,
    ) => [pkg, Math.max(was?.[pkg] ?? 0, next[pkg] ?? 0)]),
  )
}

/** A code rollback keeps the newest vocabulary and its immutable chain. */
export let retainedLenses = (was: VocabDoc, next: VocabDoc): VocabDoc => {
  if (!declaredLenses(was)) {
    return declaredLenses(next) ? contractedLenses(next) : next
  }
  // An unseen step must follow the newest retained step. A branch rebased
  // behind another migration re-stamps its new step before it can deploy.
  let held = Object.values(was.$defs ?? {}).filter((s) => s.lens === true)
  let newest = Math.max(...held.map((s) => Number(s.step)))
  for (let s of Object.values(next.$defs ?? {})) {
    if (s.lens !== true || held.some((h) => h.step === s.step)) continue
    if (Number(s.step) <= newest) {
      throw new Refused(
        `Lens: step ${s.step} must follow ${newest}; re-stamp it`,
      )
    }
  }
  let incoming = Object.values(next.$defs ?? {}).filter((s) => s.lens === true)
  for (let s of incoming) {
    let previous = held.find((h) => h.step === s.step)
    if (previous && JSON.stringify(previous.ops) !== JSON.stringify(s.ops)) {
      throw new Refused(`Lens: immutable step ${s.step} changed`)
    }
  }
  let rollback = !incoming.some((s) => Number(s.step) >= newest)
  let defs = { ...(rollback ? was.$defs : next.$defs) }
  for (let [name, s] of Object.entries(was.$defs ?? {})) {
    if (s.lens !== true) continue
    let replacement = Object.values(defs).find((d) =>
      d.lens === true && d.step === s.step
    )
    if (
      replacement && JSON.stringify(replacement.ops) !== JSON.stringify(s.ops)
    ) {
      throw new Refused(`Lens: immutable step ${s.step} changed`)
    }
    if (replacement) continue
    if (defs[name] && defs[name].lens !== true) {
      throw new Refused(`Lens: retained step conflicts with ${name}`)
    }
    defs[name] ??= s
  }
  // Source components still express membership to old readers. Terminal
  // destinations retain their schema even when kept code never declared them.
  let obsolete = new Set(lensObsolete({ ...next, $defs: defs }))
  for (let path of lensPaths(was)) {
    let [comp, prop] = path.split('.')
    let schema = was.$defs?.[comp]
    let property = schema?.properties?.[prop]
    if (!schema) continue // Core columns are the platform's.
    let kept = defs[comp] ?? { ...schema, properties: {} }
    defs[comp] = property && !obsolete.has(path)
      ? {
        ...kept,
        properties: { ...kept.properties, [prop]: property } as Record<
          string,
          PropSchema
        >,
      }
      : kept
  }
  return contractedLenses({ ...(rollback ? was : next), $defs: defs })
}

let renames = (doc: VocabDoc) =>
  lensesIn([lensDocAt('schema', doc)]).toSorted((a, b) =>
    Number((a._lens as Comp).step) - Number((b._lens as Comp).step)
  ).flatMap((
    row,
  ) => ((row._lens as Comp).ops as { rename: { from: string; to: string } }[]))

export let lensSources = (doc: VocabDoc): string[] =>
  renames(doc).map((op) => op.rename.from)

/** The graph pilot uses comp.prop renames; JSON document operations remain
 * independent of the store's schema and mover. */
export let lensPaths = (doc: VocabDoc): string[] =>
  renames(doc).flatMap((op) => [op.rename.from, op.rename.to])

/** Consumed names, excluding a name a later step deliberately restores. */
export let lensObsolete = (doc: VocabDoc): string[] => {
  let paths = new Set<string>()
  for (let { rename } of renames(doc)) {
    paths.delete(rename.to)
    paths.add(rename.from)
  }
  return [...paths]
}

/** The desired schema after movement. `grew` retains any nonempty source. */
export let contractedLenses = (doc: VocabDoc): VocabDoc => {
  let defs = { ...doc.$defs }
  for (let path of lensObsolete(doc)) {
    let [comp, prop] = path.split('.')
    if (!defs[comp]?.properties?.[prop]) continue
    let properties = { ...defs[comp].properties }
    delete properties[prop]
    defs[comp] = { ...defs[comp], properties }
  }
  return { ...doc, $defs: defs }
}

export let spoken = (request: Request): ReadOpts => {
  let said = request.headers.get('x-yak-speaks')
  return said ? { speaks: JSON.parse(said) } : {}
}

// Only lens apps reach this lookup. A deploy's vocabulary bytes are immutable,
// so repeated API calls from the same page never re-read the directory or R2.
let kept = new Map<string, Record<string, number>>()
export let pageSpeaks = async (
  request: Request,
  dir: Directory,
  blobs: Objects,
  space: Space,
  app: App,
  readDoc: (source: string, file: string) => VocabDoc,
): Promise<Record<string, string>> => {
  if (!app.lenses) return {}
  let raw = request.headers.get('x-yak-version') ??
    (new URL(request.url).pathname.endsWith('/ws')
      ? new URL(request.url).searchParams.get('version')
      : null)
  if (raw == null) return {}
  let n = Number(raw)
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(n)) {
    throw new Refused('invalid page version')
  }
  let key = `${app.eid}/${n}`
  let speaks = kept.get(key)
  if (!speaks) {
    let deploy = (await dir.deploys(app)).find((v) => v.version == n)
    if (!deploy) throw new Refused(`no kept page version ${n}`)
    let file = ['vocab.yml', 'vocab.json'].find((f) => deploy.files[f])
    let doc: VocabDoc = {}
    if (file) {
      let bytes = await pins(blobs, `${prefixOf(space, app)}/`).get(
        deploy.files[file],
      )
      if (!bytes) throw new Error(`no vocabulary for page version ${n}`)
      doc = readDoc(new TextDecoder().decode(bytes), file)
    }
    let name = storeName(space, app)
    speaks = versions([lensDocAt(name, doc)])
    // An old vocabulary with no step still speaks the app's version zero.
    kept.set(key, speaks)
    if (kept.size > 128) kept.delete(kept.keys().next().value!)
  }
  let latest = app.lenses
  if (
    Object.keys(latest).length == Object.keys(speaks).length &&
    Object.entries(latest).every(([pkg, version]) => speaks[pkg] === version)
  ) return {}
  return { 'x-yak-speaks': JSON.stringify(speaks) }
}

export let LENS_MARK = 'yak/store/lens-contract' as const

/** Scoped to this app's own declarations, never a fleet recipe rename. */
export let lensRule = (
  name: string,
  doc: VocabDoc,
  admits: (path: string) => boolean = () => true,
): Rule | null => {
  if (!declaredLenses(doc)) return null
  let rows = lensesIn([lensDocAt(name, doc)])
  let latest = versions([lensDocAt(name, doc)])
  let source = lensSources(doc)
  let lens = compile(
    rows,
    Object.fromEntries(
      Object.keys(latest).map((pkg) => [pkg, 0]),
    ),
  )
  return {
    mark: `${LENS_MARK}/${Object.values(latest)[0]}` as Mark,
    live: 'apps',
    find: source.some(admits)
      ? and(or(...source.filter(admits).map((p) => present(p))), every())
      : and(never()),
    drop: lensObsolete(doc).filter((path) => {
      let [comp, prop] = path.split('.')
      return !!doc.$defs?.[comp]?.properties?.[prop]
    }),
    move: (row: Bundle) => {
      if (
        !source.some((path) => {
          let [comp, prop] = path.split('.')
          return (row[comp] as Comp | undefined)?.[prop] != null
        })
      ) return []
      // Storage returns null for an empty column. A snapshot's null is
      // absence; a patch's null is a clear, which must not erase its target.
      let present = Object.fromEntries(
        Object.entries(row).map(([name, comp]) => [
          name,
          comp && typeof comp == 'object' && !Array.isArray(comp)
            ? Object.fromEntries(
              Object.entries(comp).filter(([, v]) => v != null),
            )
            : comp,
        ]),
      ) as Bundle
      let patch = lens.put(present)
      for (let path of source) {
        let [comp, prop] = path.split('.')
        if ((row[comp] as Comp | undefined)?.[prop] == null) continue
        patch[comp] = { ...patch[comp] as Comp, [prop]: null }
      }
      return [patch]
    },
  }
}
