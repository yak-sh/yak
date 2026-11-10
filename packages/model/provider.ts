// A provider as a plugin. A package that serves models exports `./provider`,
// and a host running conversations asks each plugin its config names for the
// models it serves, lending them what only the host has: its connections, the
// person's sign-ins, where generated media is kept and its settings. A plugin
// never says where it runs, and the host never names a provider.

import type { ArtifactStore } from '@yaks/blob'
import type { Affordable } from './afford.ts'
import type { Listed, MediaReceipts, Model } from './mod.ts'

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
  /** where a call's private provider results are kept, so an interrupted
   * call is delivered again without being bought again (a host that keeps
   * none lends none) */
  receipts?: MediaReceipts
}

/** What a host holds a provider's own calls to ({@link Native}): each is
 * quoted before it is made, held to what the quote affords of what remains,
 * and settled at what it cost. */
export type Spending = {
  /** the most `quote` affords of what remains, held until settled; refused
   * (a `ModelError` coded `limit`) where nothing fits */
  hold: (quote: (remaining: number) => Affordable | null) => Promise<{
    value: Affordable
    settle: (dollars: number, reported: boolean) => Promise<unknown>
  }>
  /** a model answered, as its provider lists it */
  answered?: (name: string, info: Listed) => Promise<void>
  /** a failure that is the host's to hear rather than the caller's, such as
   * the account's own credit spent */
  report?: (error: unknown, model: string) => void
}

/** A provider's own door: one call to a model, as the provider's API takes
 * it, answered with what the model said. */
export type Native = {
  /** whether it answers `model`; a door that doesn't say answers every name */
  serves?: (model: string) => boolean
  run: (
    model: string,
    input: unknown,
    options?: { extraHeaders?: Record<string, string> },
  ) => Promise<unknown>
}

/** A `./provider` facet: the models a plugin serves, keyed by the
 * `provider.name` each serves under, given what the host lends and the
 * plugin's own options from the config. */
export type ProviderFacet = {
  providers?: (
    lent: Lent,
    options: Record<string, unknown>,
  ) => Record<string, Model>
  /** the hosts those models call with these options: where a host may send a
   * credential it puts in their calls, and nowhere else */
  hosts?: (options: Record<string, unknown>) => string[]
  /** its own door, each call held to what `spending` affords, for a host
   * that passes a caller's input to the provider as it is */
  native?: (
    lent: Lent,
    options: Record<string, unknown>,
    spending: Spending,
  ) => Native
}
