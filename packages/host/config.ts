// Composition configuration. A concrete host interprets its storage locator.
import type { FacetName } from './facets.ts'
import { CallError } from '@yaks/tools/errors'
import { prefixes } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
/** The options a config passes to one plugin, given to each of that plugin's
 * exported factories as the second argument, after the host. A value written
 * `{"secret": "NAME"}` is that secret's value, read every time it is accessed
 * ({@link revealed}), so a config names a secret without holding one — and
 * a factory that re-reads its options picks up a secret written after the host
 * started. A runtime that holds bindings lends one written `{"binding":
 * "NAME"}` the same way. */
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
  /** Systemd unit templates rolled by `yak restart`. A worker selects its
   * entry with `yak work --process <unit>`; omitted roles takes all duties
   * except those explicitly excluded. Optional entries roll only if active. */
  processes?: {
    unit: string
    roles?: string[]
    except?: string[]
    optional?: boolean
  }[]
  /** Explicit connector bindings for file-and-command workspace targets. */
  workspaces?: {
    connectors: Record<string, { use: string; with?: Record<string, unknown> }>
    receipts: string
  }
  /** Sandbox adapters, separate from computer connection transports. */
  sandboxes?: import('@yaks/sandbox/lifecycle').Configuration & {
    defaultProvider?: string
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
  /** the kinds of store one host serves, each by its own config: a Worker
   * whose one object class opens a recipe app's store and the platform's
   * directory alike gives each kind its own plugins. A store reads its
   * kind's; the host's own `plugins` are what serves them. */
  stores?: Record<string, Config>
  /** what `yak serve` listens on (default @yaks/api's `PORT`) */
  port?: number
  /** which interface it binds (default @yaks/api's `HOSTNAME`, this machine
   * alone; `0.0.0.0` offers it to every network the machine is on) */
  hostname?: string
  /** whether the store gives entities a human id such as `T-7`, in the series
   * of the letter a component declares (@yaks/id). Opt-IN: left out, no entity
   * gets one, because a number exists for a person to type and most hosts have
   * nobody typing. `{ except: [comp, …] }` numbers in every series but those
   * components': an entity carrying one is numbered only by another lettered
   * component it carries ({@link numbering}). */
  numbers?: boolean | { except: string[] }
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

/** How a config's store numbers its entities (@yaks/sqlite `Numbering`):
 * not at all, or in the series of each letter a component declares (@yaks/id),
 * less the config's `except` and the components a host keeps off the human
 * line on its own (`unnumbered`).
 *
 * ```ts
 * import { numbering } from '@yaks/host/config'
 * import { idKeywords } from '@yaks/id'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * const vocab = loadVocab({
 *   $defs: {
 *     task: { component: true, prefix: 'T', properties: {} },
 *     mail: { component: true, prefix: 'E', properties: {} },
 *     person: { component: true, prefix: 'U', properties: {} },
 *   },
 * }, [idKeywords])
 * equal(numbering(vocab, undefined), false)
 * equal(numbering(vocab, { except: ['mail'] }, ['person']), { task: 'T' })
 * ```
 */
export let numbering = (
  vocab: Vocab,
  numbers: Config['numbers'],
  unnumbered: readonly string[] = [],
): false | Record<string, string> => {
  if (!numbers) return false
  let except = [...unnumbered, ...numbers === true ? [] : numbers.except]
  return Object.fromEntries(
    Object.entries(prefixes(vocab)).filter(([c]) => !except.includes(c)),
  )
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

/** How a host reads what a config names without holding: each kind of
 * reference (`secret`, `binding`) it can read, by the name written in it. */
export type Reveal = Partial<
  Record<'secret' | 'binding', (name: string) => unknown>
>

// Only data is looked into: an instance a host passed in keeps its prototype.
let plain = (value: unknown): value is object =>
  !!value && typeof value == 'object' &&
  [Object.prototype, Array.prototype, null].includes(
    Object.getPrototypeOf(value),
  )

// The kind and name of a reference, `{"secret": "NAME"}`, when the object
// holds nothing else and the host reads that kind.
let reference = (value: unknown, reveal: Reveal) => {
  if (!plain(value) || Array.isArray(value)) return
  let [entry, ...rest] = Object.entries(value)
  if (!entry || rest.length || typeof entry[1] != 'string') return
  let read = reveal[entry[0] as keyof Reveal]
  if (read) return () => read(entry[1] as string)
}

/**
 * Options with each reference in them read by `reveal` at the moment it is
 * accessed, so a value that arrives after the host started is read the next
 * time. A reference whose kind the host does not read stays as written.
 *
 * ```ts
 * import { revealed } from '@yaks/host/config'
 * import { equal } from '@yaks/testing'
 *
 * let env: Record<string, unknown> = { TOKEN: 't' }
 * let options = revealed(
 *   { token: { secret: 'TOKEN' }, mail: { binding: 'MAIL' }, base: 'x' },
 *   { secret: (name) => env[name] },
 * ) as Record<string, unknown>
 * equal(options, { token: 't', mail: { binding: 'MAIL' }, base: 'x' })
 * env.TOKEN = 'u'
 * equal(options.token, 'u')
 * ```
 */
export let revealed = (value: unknown, reveal: Reveal): unknown => {
  // A whole value written as a reference has no parent object to define a
  // getter on, so it is read here, once.
  let read = reference(value, reveal)
  if (read) return read()
  if (!plain(value)) return value
  let out = (Array.isArray(value) ? [] : {}) as Record<string, unknown>
  for (let [k, v] of Object.entries(value)) {
    let later = reference(v, reveal)
    if (later) {
      Object.defineProperty(out, k, {
        get: later,
        enumerable: true,
        configurable: true,
      })
    } else out[k] = revealed(v, reveal)
  }
  return out
}

/** A {@link Reveal} that reads every kind from one record by name: a Worker's
 * env, which holds its secrets and its bindings alike. */
export let holding = (held: object): Reveal => {
  let read = (name: string) => (held as Record<string, unknown>)[name]
  return { secret: read, binding: read }
}

/** Each plugin a config names, with its options, each reference among them
 * read by `reveal` when accessed. */
export let configured = (config: Config, reveal: Reveal = {}): Configured[] =>
  (config.plugins ?? []).map((plug) => [
    used(plug),
    (Object.keys(reveal).length
      ? revealed(given(plug), reveal)
      : given(plug)) as Options,
    chosen(plug),
    facetsOf(plug),
  ])

/**
 * Refuse a store whose data requires a plugin this config does not compose:
 * one it does not list, or lists with its graph facet left out, which is where
 * a plugin's writes are shaped. `requirements` is what the store recorded
 * (@yaks/sqlite `requirements`), and the error names every one missing.
 *
 * ```ts
 * import { meet } from '@yaks/host/config'
 * import { throws } from '@yaks/testing'
 *
 * meet({ plugins: ['@yaks/blob'] }, ['@yaks/blob'])
 * await throws(
 *   () => meet({ plugins: ['@yaks/doc'] }, ['@yaks/blob', '@yaks/journal']),
 *   'requires @yaks/blob and @yaks/journal,',
 * )
 * ```
 */
export let meet = (config: Config, requirements: readonly string[]): void => {
  let composed = new Set(
    (config.plugins ?? []).filter((p) => facetsOf(p)?.includes('graph') ?? true)
      .map(used),
  )
  let missing = requirements.filter((p) => !composed.has(p))
  if (missing.length) throw new Unmet(missing)
}

// `a`, `a and b`, `a, b and c`.
let listed = (names: string[]) =>
  names.length == 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** A store requires plugins its opener's config does not compose. */
export class Unmet extends CallError {
  constructor(public plugins: string[]) {
    let one = plugins.length == 1
    super(
      'config',
      `this store requires ${listed(plugins)}, which this config does not ` +
        `compose: list ${one ? 'it' : 'them'} in plugins or, if ` +
        `${one ? 'it was' : 'they were'} removed on purpose, drop the ` +
        `store's ${one ? 'requirement' : 'requirements'} (@yaks/sqlite ` +
        'REQUIRED)',
    )
    this.name = 'Unmet'
  }
}
