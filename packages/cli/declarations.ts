// Command declarations are data. The memo keeps neither a vocabulary runtime
// nor any closures; the chosen command loads its implementation by role.
import { type Config, located, used } from './config.ts'
import { chosen, facetsOf } from '@yaks/host/config'
import type { Declared } from './words.ts'
import type { CliCommand, CliFacet } from './host.ts'
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
  controls: {
    plugin: string
    value: {
      commands: Control[]
      globals?: CliFacet['globals']
      tools?: string[]
    } | null
  }[]
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
  // Options are capabilities lent to running factories. They neither change
  // declarations nor belong in a discovery cache's identity or serialization.
  let inputs = (config.plugins ?? []).map((input) => ({
    use: used(input),
    words: chosen(input),
    facets: facetsOf(input),
  }))
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
    async () =>
      (await import('./derive.ts')).derive(
        { ...config, plugins: inputs },
        controls,
      ),
    {
      callbacks: { cli: ['run'] },
      // A plugin found where the loader finds it: an installed `yak` names
      // its packages at its own release on JSR (./config.ts `located`). The
      // loader is asked once for a module it finds, which is nearly every
      // one, and a miss tells `located` why.
      resolve: (specifier) => {
        try {
          return import.meta.resolve(specifier)
        } catch (error) {
          return import.meta.resolve(located(specifier, () => {
            throw error
          }))
        }
      },
    },
  )
  held.set(key, made)
  made.catch(() => held.delete(key))
  return made
}
