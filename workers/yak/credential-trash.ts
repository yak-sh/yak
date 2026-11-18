// A retained credential is private vault data; the graph says whose it is.
// Only its owner sees its metadata, restores it, or confirms a permanent purge.
import type { Bundle, Comp } from '@yaks/graph'
import type { Trashed } from '@yaks/secrets'
import { line } from '@yaks/query'
import type { Kind } from './confirm.ts'
import { type Directory, idOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { vaulted, vaultOf } from './vault.ts'
import { refuse } from './tool.ts'

export type Credential = Trashed & {
  integration: string
  row: Bundle
  deleted: boolean
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** Metadata only. Current ownership wins over historical ownership. */
export let retainedCredentials = async (
  env: Env,
  dir: Directory,
  space: Space,
  person: string,
): Promise<Credential[]> => {
  if (!vaulted(env)) return []
  let saved = await vaultOf(env).trash()
  let eids = [...new Set(saved.map((s) => s.eid))]
  if (!eids.length) return []
  let [live, history] = await Promise.all([
    dir.read(line`.entity.eid=${eids}&.connection&?secret`),
    dir.trash(eids),
  ])
  let current = new Map(live.map((b) => [b.entity.eid, b]))
  let previous = new Map<string, Bundle>()
  for (let entry of history) {
    for (let b of entry.bundles) {
      if (b.connection && !previous.has(b.entity.eid)) {
        previous.set(b.entity.eid, b)
      }
    }
  }
  return saved.flatMap((one) => {
    let row = current.get(one.eid) ?? previous.get(one.eid)
    let c = comp(row, 'connection')
    let owner = c?.owner && idOf(c.owner as string)
    return row && (owner == space.eid || owner == person)
      ? [{
        ...one,
        integration: String(c?.integration ?? one.name ?? 'Connection'),
        row,
        deleted: !current.has(one.eid),
      }]
      : []
  })
}

export let credentialAt = async (
  env: Env,
  dir: Directory,
  space: Space,
  person: string,
  id: string,
) =>
  (await retainedCredentials(env, dir, space, person)).find((one) =>
    one.id == id
  ) ?? null

/** Restore its connection and chosen value without disturbing later app bindings. */
export let restoreCredential = async (
  env: Env,
  dir: Directory,
  one: Credential,
  who: Who,
) => {
  let saved = await vaultOf(env).past(one.id)
  if (!saved) {
    throw refuse(
      'conflict',
      'This saved credential is no longer available. Choose another saved version.',
    )
  }
  await dir.apply({
    entities: [{
      entity: { eid: one.eid },
      connection: {
        ...one.deleted ? one.row.connection as Comp : {},
        status: 'connected',
      },
      secret: {
        ...comp(one.row, 'secret'),
        value: saved.value ?? saved.op ?? '',
      },
    }],
  }, vouched(who))
  return `${one.integration}'s saved credential is restored. Its connection is available on this page; choose which apps use it.`
}

export let trashedCredential: Kind<Credential> = {
  kind: 'credentialerase',
  find: (dir, space, target, env, person) =>
    credentialAt(env, dir, space, person ?? '', target),
  typed: (one) => one.integration,
  title: (one) => `Erase the saved ${one.integration} credential for good?`,
  until: () =>
    'The saved credential remains private and recoverable in the trash.',
  lines: (_space, one) => [
    `the saved ${one.integration} credential version from ${
      new Date(one.at).toISOString()
    }`,
    'the chance to restore this saved version; its current connection and other saved versions remain',
  ],
  press: () => 'Erase this saved credential forever',
  act: async (env, dir, _space, one) => {
    let vault = vaultOf(env)
    await vault.purge(one.id)
    let [active, saved] = await Promise.all([
      vault.read(one.eid),
      vault.trash(),
    ])
    if (!active && !saved.some((s) => s.eid == one.eid)) {
      await dir.purgeTrashEntities([one.eid])
    }
    return `The saved ${one.integration} credential version is permanently erased.`
  },
}
