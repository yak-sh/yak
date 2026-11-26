// The directory and Store standing a delegated service operation depends on.
import { stringify, whole } from '@yaks/query'
import type { Bundle, Taken } from '@yaks/graph'
import {
  type Read,
  type ServiceAuthority,
  serviceAuthority,
} from '@yaks/connections'
import { mode, reads } from '@yaks/member'
import { mayCall } from '@yaks/tools/declared'
import { toolsOf } from './declaration.ts'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'

export type Source = { space: Space; app: App }

/** A service customer uses the source app under a seat or an app grant
 * when the source is private. */
export let serviceRole = async (
  dir: Pick<Directory, 'role' | 'grant'>,
  source: Source,
  person: string,
) =>
  await dir.role(source.space, person) ??
    (await dir.grant(source.app, person))?.access ?? null

// A tree is printed as the line it parses back from.
export let serviceRead = (env: Env): Read => (said) => {
  let q = said as Taken
  return meta(env).query(
    typeof q == 'string' ? q : whole(stringify(q)),
  ) as Promise<Bundle[]>
}

/** Recheck after a queue delay as well as at the initial dispatch. */
export let verifyService = async (
  env: Env,
  dir: Directory,
  a: ServiceAuthority,
) => {
  if (!await serviceAuthority(serviceRead(env), a)) return false
  let source = await dir.appAt(a.app)
  if (
    !source || source.app.trashed || source.space.trashed ||
    source.space.eid != a.space
  ) return false
  let access = mode(source.app.access)
  if (!reads(access, null) && !await serviceRole(dir, source, a.person)) {
    return false
  }
  let target = await dir.appAt(a.service)
  if (!target || target.app.trashed || target.space.trashed) return false
  let tool = (await toolsOf(env, target.space, target.app))[a.operation]
  return !!tool?.service && !!tool.worker &&
    mayCall(tool.floor, a.person, null)
}
