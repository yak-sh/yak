// Composition configuration. A concrete host interprets its storage locator.
import type { FacetName } from './facets.ts'
/** The options a config passes to one plugin, given to each of that plugin's
 * exported factories as the second argument, after the host. A value written
 * `{"secret": "NAME"}` is that secret's value, read every time it is accessed
 * (host.ts `revealing`), so a config names a secret without holding one — and
 * a factory that re-reads its options picks up a secret written after the host
 * started. */
export type Options = Record<string, unknown>

/** A plugin a config names: a bare specifier, or one with options and chosen words. */
export type Plug = string | {
  use: string
  with?: Options
  words?: string[]
  /** The facets this host composes; omitted takes all exported facets. */
  facets?: FacetName[]
}

/** A resolved plugin, its options and optional word and facet selections. */
export type Configured = [string, Options, string[]?, FacetName[]?]

/** A config file: where the graph lives, and what reads and writes it. */
export type Config = {
  /** Explicit connector bindings for file-and-command workspace targets. */
  workspaces?: {
    connectors: Record<string, import('@yaks/machine').ProviderConfig>
    receipts: string
  }
  /** Configured machine providers, keyed by the durable machine.provider. */
  machines?: {
    defaultProvider: string
    providers: Record<string, import('@yaks/machine').ProviderConfig>
  }
  /** the SQLite file, or `:memory:` for a graph that lasts as long as the
   * process. Required — a host never guesses a database. */
  db?: string
  /** Report to this durable spool without opening the tracker graph. */
  tracker?: { spool: string; commit?: string }
  /** the plugin packages, by import specifier. A relative specifier is
   * resolved against the config file itself; `{use, with, words, facets}` names one
   * with options and an optional list of its vocabulary definitions. Omitted
   * `words` takes its whole vocabulary; `[]` takes none of its definitions.
   * `facets` restricts which subpaths are imported; omitted takes all. */
  plugins?: Plug[]
  /** what `yak serve` listens on (default @yaks/api's `PORT`) */
  port?: number
  /** which interface it binds (default @yaks/api's `HOSTNAME`, this machine
   * alone; `0.0.0.0` offers it to every network the machine is on) */
  hostname?: string
  /** whether the store mints a short human-readable number beside each entity
   * id. Opt-IN: left out, no entity gets one, because a number exists for a
   * person to type and most hosts have nobody typing. `{ except: [comp, …] }`
   * turns them on for everything except entities carrying those components —
   * what a host using @yaks/archetype wants, since a descriptor is bookkeeping
   * nobody refers to by number. */
  numbers?: boolean | { except: string[] }
  /** reuse the `num` an incoming entity already carries instead of minting a
   * new one — what a store seeded from another store's export needs, and never
   * what a host serving clients wants (default false) */
  adopt?: boolean
  /** what the MCP server calls itself (default `yak`) */
  name?: string
  /** the person who works at this machine, as any id the graph resolves (an
   * eid, a human id, a name). What they type here is signed with them: a
   * prompt their harness's transcript marks as typed (@yaks/session
   * `service`), a line typed into the harness's terminal (@yaks/harness), and
   * a command line run at a terminal that names no session (./local.ts
   * `signer`). Left out, nothing is signed as a person: a machine never
   * guesses who is at its keyboard (./host.ts `person`). */
  person?: string
  /** how long this process's lease on a duty, or its claim on an effect
   * run, stands before another process may take it over, in milliseconds
   * (default 30_000 for a duty, 60_000 for a run). A holder still doing the
   * work renews it on a timer; one that was killed leaves a lease that
   * expires, which is how a second long-running process takes over without
   * anybody having to reap the first. */
  lease?: number
  /** whether this process runs its duties: the effect pool, each plugin's
   * `./service`, and the start-up passes a plugin holds a lease for (default
   * true). `false` takes no lease, works no effects and runs none of them, so
   * the process answers what it is asked and nothing else — what its writes
   * owe is left written down for a process that does — what `yak --no-duties`
   * sets. */
  duties?: boolean
}

/** The package a plugin entry names. */
export let used = (plug: Plug): string =>
  typeof plug == 'string' ? plug : plug.use
/** The options passed to its factories. */
export let given = (plug: Plug): Options =>
  typeof plug == 'string' ? {} : plug.with ?? {}
/** The definitions selected from its vocabulary, or all when omitted. */
export let chosen = (plug: Plug): string[] | undefined =>
  typeof plug == 'string' ? undefined : plug.words

/** The facets selected for this host, or all when omitted. */
export let facetsOf = (plug: Plug): FacetName[] | undefined =>
  typeof plug == 'string' ? undefined : plug.facets
