// One module graph for a command's runtime and the facets it will consume.
// Metadata discovery imports none of this code; graph tools and rendering
// arrive only when a command asks for them.
import { type Config, subpaths, used } from './config.ts'
import { declarations } from './declarations.ts'
import { ROLES, rolesOf } from './roles.ts'
import type { Command } from './run.ts'

export let prepare = async (
  config: Config,
  command: Pick<Command, 'name' | 'roles'>,
  selected?: readonly [plugin: string, facet: 'cli' | 'tools'],
  draw = false,
): Promise<typeof import('./local.ts')> => {
  let said = await declarations(config, true)
  let roles = rolesOf(command, said.pooled)
  let owner = command.name && said.owners[command.name]
  selected ??= owner ? [owner, 'tools'] : undefined
  let factories = new Set(
    said.vocabs.filter((v) => v.factories).map((v) => v.plugin),
  )
  let requests = (config.plugins ?? []).map(used).flatMap((plugin) => {
    let names: string[] = []
    for (let role of roles) {
      if (Object.hasOwn(ROLES, role)) {
        names.push(
          ...ROLES[role as keyof typeof ROLES].filter((name) =>
            name != 'tools' && (name != 'vocab' || factories.has(plugin))
          ),
        )
      } else if (role == plugin) names.push('service')
    }
    if (selected?.[0] == plugin) names.push(selected[1])
    if (draw && selected?.[1] != 'cli') names.push('views')
    return [...new Set(names)].filter((name) =>
      said.facets[plugin].includes(name)
    ).map((name) => [plugin, name] as const)
  })
  let modules = await subpaths(requests, [
    new URL('./local.ts', import.meta.url).href,
  ])
  return modules.at(-1) as typeof import('./local.ts')
}
