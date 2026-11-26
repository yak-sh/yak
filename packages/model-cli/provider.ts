/** Opt-in native CLI providers for a graph's configured effects host. @module */
import type { Lent, Model } from '@yaks/model'
import { cliModel, type Options, type Vendor } from './mod.ts'

/** Each provider is enabled by its own configuration object. */
export type Config = Partial<Record<Vendor, Options>>

/** The signed-in CLIs on this host. Only the host's environment lookup is lent
 * to the adapter. */
export let providers = (
  lent: Lent,
  options: Config = {},
): Record<string, Model> =>
  Object.fromEntries(
    (['grok', 'antigravity'] as const).flatMap((name) =>
      options[name] ? [[name, cliModel(name, options[name], lent.env)]] : []
    ),
  )
