// A provider as a plugin. A package that serves models exports `./provider`,
// and a host running conversations asks each plugin its config names for the
// models it serves, lending them what only the host has: its connections, the
// person's sign-ins, where generated media is kept and its settings. A plugin
// never says where it runs, and the host never names a provider.

import type { ArtifactStore } from '@yaks/blob'
import type { Model } from './mod.ts'

/** What a host lends the providers it composes. */
export type Lent = {
  /** the connections every provider shares (a pool the host closes) */
  fetch: typeof fetch
  /** the key the person signed in to `integration` with, if they did */
  key: (integration: string) => Promise<string | undefined>
  /** a fresh key for `integration`, when `stale` stopped working */
  refresh: (integration: string, stale: string) => Promise<string | undefined>
  /** where media a model generates is kept */
  store: ArtifactStore
  /** the host's settings, `OPENAI_API_KEY` among them */
  env: (name: string) => string | undefined
}

/** A `./provider` facet: the models a plugin serves, keyed by the
 * `provider.name` each serves under, given what the host lends and the
 * plugin's own options from the config. */
export type ProviderFacet = {
  providers?: (
    lent: Lent,
    options: Record<string, unknown>,
  ) => Record<string, Model>
}
