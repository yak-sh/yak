// Command declarations are data. The memo keeps neither a vocabulary runtime
// nor any closures; the chosen command loads its implementation by role.
import { type Config, used } from './config.ts'
import { facetsOf } from '@yaks/host/config'
import type { Declared } from './words.ts'
import type { CliCommand } from './host.ts'
import type { VocabFacet } from '@yaks/host'
import { remember } from './memo.ts'
type Control = Omit<CliCommand, 'run'>
export type Declarations = {
  facets: Record<string, string[]>
  vocabs: {
    plugin: string
    value: Pick<VocabFacet, 'description' | 'docs' | 'keywords'> | null
    factories: boolean
  }[]
  controls: { plugin: string; value: { commands: Control[] } | null }[]
  tools: Declared[]
  owners: Record<string, string>
  pooled: boolean
}
let held = new Map<string, Promise<Declarations>>()

/** A process shares its validated command data between discovery and invocation. */
export let declarations = (
  config: Config,
  controls = false,
): Promise<Declarations> => {
  let inputs = config.plugins ?? []
  let key = JSON.stringify([inputs, controls])
  let known = held.get(key) ??
    (!controls && held.get(JSON.stringify([inputs, true])))
  if (known) return known
  let requests = inputs.flatMap((input) =>
    ['vocab', ...controls ? ['cli'] : []].filter((name) =>
      facetsOf(input)?.some((facet) => facet == name) ?? true
    ).map((name) => [used(input), name] as const)
  )
  let made = remember(
    [inputs, controls],
    [
      import.meta.url,
      new URL('./derive.ts', import.meta.url).href,
      ...requests,
    ],
    async () => (await import('./derive.ts')).derive(config, controls),
    {
      callbacks: { cli: ['run'] },
    },
  )
  held.set(key, made)
  made.catch(() => held.delete(key))
  return made
}
