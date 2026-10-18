// Workspace placement is stable for the lifetime of its resource. Home writes
// through any door must name a workspace and an absolute command directory.
import { type Bundle, type Comp, hook, type Plugin } from '@yaks/graph'

export let workspacePolicy = (): Plugin => ({
  name: '@yaks/machine/workspaces',
  authorize: hook(['home', 'workspace'], async (bundles, tx) => {
    let held = new Map(
      (await tx.get(bundles.map((b) => b.entity.eid))).map((
        b,
      ) => [b.entity.eid, b]),
    )
    let merged = new Map<string, Bundle>()
    for (let b of bundles) {
      let old = merged.get(b.entity.eid) ?? held.get(b.entity.eid)
      let record = { ...old, ...b }
      for (let name of ['home', 'workspace']) {
        if (b[name]) {
          record[name] = { ...old?.[name] as Comp, ...b[name] as Comp }
        }
      }
      merged.set(b.entity.eid, record)
      let before = held.get(b.entity.eid)?.workspace as Comp | undefined
      if (before && Object.hasOwn(b, 'workspace')) {
        let after = record.workspace as Comp | null
        for (let property of ['root', 'machine', 'sandbox']) {
          if (
            property == 'root' && before.root == null &&
            held.get(b.entity.eid)?.pending
          ) continue
          if ((before[property] ?? null) !== (after?.[property] ?? null)) {
            throw new Error('Workspace placement is immutable: ' + property)
          }
        }
      }
    }
    for (let b of merged.values()) {
      if (!b.home || b.$delete) continue
      let home = b.home as Comp
      if (
        home.cwd != null &&
        (typeof home.cwd != 'string' || !home.cwd.startsWith('/') ||
          home.cwd.includes('\0'))
      ) {
        throw new Error('Home cwd must be an absolute path')
      }
      if (home.workspace != null) {
        let id = String(home.workspace)
        let target = merged.get(id) ?? (await tx.get([id]))[0]
        if (!target?.workspace || target.$delete) {
          throw new Error('Not a workspace: ' + id)
        }
      }
    }
    return bundles
  }),
})

/** Graph facet: the policy applies to generic graph writes as well as tools. */
export let plugins = (): Plugin[] => [workspacePolicy()]
