// The public catalog reads operation metadata from the selected release.
import type { Listed } from '@yaks/connections'
import { schemaOf } from '@yaks/tools/declared'
import type { Directory } from './directory.ts'
import type { Env } from './env.ts'
import { declarationOf } from './declaration.ts'

export let serviceOffer = async (env: Env, dir: Directory, offer: Listed) => {
  let target = offer.service && await dir.appAt(offer.service.app)
  if (!target || target.app.trashed || target.space.trashed) return null
  let { tools } = await declarationOf(env, target.space, target.app)
  let commands = Object.entries(tools).flatMap(([name, tool]) =>
    tool.service && tool.discoverable !== false
      ? [{
        name,
        description: tool.description,
        input: schemaOf(tool),
        revision: tool.revision,
        floor: tool.floor,
        pricing: tool.service.pricing,
      }]
      : []
  )
  return commands.length ? { ...offer, commands } : null
}
