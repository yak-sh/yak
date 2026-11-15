// An app's lenses: the renames its own `vocab.json` declares, at the package
// `@app/<name>` names, and the session words every hosted store speaks at their
// first version. What a page speaks, what a deploy keeps when its code rolls
// back, and what a store contracts to once a move has drained, all as pure
// functions of the declarations.
import {
  compile,
  type GraphOp,
  type Lens,
  lensesIn,
  packageEid,
  versions,
} from '@yaks/lens'
import type { Bundle, Comp, ReadOpts } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import { sessionDoc } from '@yaks/session/vocab'

// The hosted session shape bridge. Kept pages speak the release they loaded;
// pending rows expand at the graph door until the bounded mover consumes them.
export let sessionStep = 20261018010000
export let sessionPackage: string = packageEid('@yaks/session')
export let sessionLens: VocabDoc = {
  package: '@yaks/session',
  $defs: {
    session_sending: {
      lens: true,
      live: false,
      step: sessionStep,
      ops: ['input', 'instructions', 'window', 'tools'].map((p) => ({
        rename: { from: `using.${p}`, to: `sending.${p}` },
      })),
    },
  },
}
export let sessionSource: VocabDoc = {
  $defs: {
    using: {
      component: true,
      type: 'object',
      extends: true,
      properties: sessionDoc.$defs!.sending.properties,
    },
  },
}
export let sessionRows = (): Bundle[] => lensesIn([sessionLens])
export let sessionBridge = (): Lens =>
  compile(sessionRows(), { [sessionPackage]: 0 })

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
  let next = {
    ...versions([lensDocAt(name, doc)]),
    [sessionPackage]: sessionStep,
  }
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
    if (!schema || obsolete.has(comp)) continue // Core columns are the platform's.
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
  ) => ((row._lens as Comp).ops as GraphOp[]))

/** The graph pilot uses comp.prop renames; JSON document operations remain
 * independent of the store's schema and mover. */
export let lensPaths = (doc: VocabDoc): string[] =>
  renames(doc).flatMap((op) =>
    'rename' in op ? [op.rename.from, op.rename.to] : [
      op.view.from,
      ...Object.values(op.view.props).flatMap((p) =>
        'path' in p ? [p.path] : []
      ),
    ]
  )

/** Consumed names, excluding a name a later step deliberately restores. */
export let lensObsolete = (doc: VocabDoc): readonly string[] =>
  compile(lensesIn([lensDocAt('schema', doc)])).sources

/** The desired schema after movement. `grew` retains any nonempty source. */
export let contractPaths = (
  doc: VocabDoc,
  paths: readonly string[],
): VocabDoc => {
  let defs = { ...doc.$defs }
  for (let path of paths) {
    let [comp, prop] = path.split('.')
    if (!prop) {
      delete defs[comp]
      continue
    }
    if (!defs[comp]?.properties?.[prop]) continue
    let properties = { ...defs[comp].properties }
    delete properties[prop]
    defs[comp] = { ...defs[comp], properties }
  }
  return { ...doc, $defs: defs }
}
export let contractedLenses = (doc: VocabDoc): VocabDoc =>
  contractPaths(doc, lensObsolete(doc))

export let spoken = (request: Request): ReadOpts => {
  let said = request.headers.get('x-yak-speaks')
  return said ? { speaks: JSON.parse(said) } : {}
}

/** What a release's pages speak: the lens steps its own vocabulary declares,
 * and the session step it shipped with. A deploy records it (`deploy.speaks`). */
export let ownSpeaks = (
  name: string,
  doc: VocabDoc,
  session = sessionStep,
): Record<string, number> => ({
  ...versions([lensDocAt(name, doc)]),
  [sessionPackage]: session,
})
