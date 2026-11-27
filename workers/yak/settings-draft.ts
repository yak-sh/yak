import { settingsDrafts } from '@yaks/platform/settings-drafts'
import type { Directory } from './directory.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { vaultOf } from './vault.ts'

export let settingsDraft = (
  req: Request,
  dir: Directory,
  env: Env,
  who: Who & { person: string },
): Promise<Response> =>
  settingsDrafts(
    req,
    {
      read: dir.read,
      apply: (entities) => dir.apply({ entities }, vouched(who)),
      reread: dir.reread,
    },
    vaultOf(env),
    who.person,
  )
