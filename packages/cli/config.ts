// The config file, read. It is the one statement of where a graph IS: the
// SQLite file, the plugins that read and write it, and how the host behaves.
//
// A config file names a graph, not a server. `yak --config yak.json task list`
// opens that file, imports those plugins and runs the tool in this process —
// SQLite in WAL mode accepts as many writers as there are `yak` commands
// running, so nothing has to be listening for a command line to work.
// `yak serve` is one more process over the same file, the one that serves HTTP
// requests — and `serve` is a tool like any other, contributed by @yaks/api.
//
// That is why this is its own module. A command that only needs to know where
// the graph is must not import host.ts, which pulls in every plugin a config
// names — a cost `yak login` should not pay. So the config is read here, by a
// module that imports no code: only this package's deno.json, for the release
// a plugin named without a map entry is taken from (`located`).

import cli from './deno.json' with { type: 'json' }

/** The options a config passes to one plugin, given to each of that plugin's
 * exported factories as the second argument, after the host. A value written
 * `{"secret": "NAME"}` is that secret's value, read every time it is accessed
 * (host.ts `revealing`), so a config names a secret without holding one — and
 * a factory that re-reads its options picks up a secret written after the host
 * started. */
export type Options = Record<string, unknown>

/** A plugin a config names: a bare specifier, or one with options. */
export type Plug = string | { use: string; with?: Options }

/** A config file: where the graph lives, and what reads and writes it. */
export type Config = {
  /** the SQLite file, or `:memory:` for a graph that lasts as long as the
   * process. Required — a host never guesses a database. */
  db?: string
  /** the plugin packages, by import specifier. A relative specifier is
   * resolved against the config file itself; `{use, with}` names one with
   * options. */
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
   * `service`), and a command line run at a terminal that names no session
   * (./local.ts `signer`). Left out, nothing is signed as a person: a machine
   * never guesses who is at its keyboard. */
  person?: string
  /** how long this process's lease on a duty stands before another
   * process may take it over, in milliseconds (default 30_000). A holder still
   * doing the work renews it on a timer; one that was killed leaves a lease
   * that expires, which is how a second long-running process takes over
   * without anybody having to reap the first. */
  lease?: number
  /** whether this process runs its duties: the effect pool, each plugin's
   * `./service`, and the start-up passes a plugin holds a lease for (default
   * true). `false` takes no lease, works no effects and runs none of them, so
   * the process answers what it is asked and nothing else — what its writes
   * owe is left written down for a process that does — what `yak --no-duties`
   * sets. */
  duties?: boolean
}

/** Where a machine keeps the config for its own graph. */
export let OWN_CONFIG = '.yak/yak.json'

/** The config a command opens: the path it was given, else `$YAK_CONFIG`,
 * else the one this machine keeps for its own graph. A machine that has a
 * graph is the ordinary case, so a bare `yak task list` there reads from it
 * rather than reaching for a remote server it was never told about. No file
 * there means no config. */
export let configPath = (
  said?: string,
  env: (name: string) => string | undefined = Deno.env.get,
): string | undefined => {
  let named = said ?? env('YAK_CONFIG')
  if (named) return named
  let home = env('HOME')
  if (!home) return undefined
  let own = `${home}/${OWN_CONFIG}`
  // The command may be running without read permission at all; that is no
  // config.
  try {
    return Deno.statSync(own).isFile ? own : undefined
  } catch {
    return undefined
  }
}

// A specifier belonging to the config file — `./plugins/mail`, `/srv/mail` —
// is resolved against the config, so a config file is movable and a bare
// `@yaks/…` is left to the import map. It names a package, never a file: a
// plugin's modules are its subpaths, and only a package has those.
let near = (spec: string, base: URL): string =>
  spec.startsWith('.') || spec.startsWith('/') ? new URL(spec, base).href : spec

/** The package a plugin entry names, either way it is written. */
export let used = (plug: Plug): string =>
  typeof plug == 'string' ? plug : plug.use

/** The options it was given, either way it is written. */
export let given = (plug: Plug): Options =>
  typeof plug == 'string' ? {} : plug.with ?? {}

// A subpath a package does not export is a module it does not have. Anything
// else that goes wrong importing one — a syntax error, a missing dependency, a
// throw at module scope — is that module failing, and is rethrown: a host that
// quietly runs without its rules is worse than one that refuses to start.
let unexported = (error: unknown, spec: string, facet: string): boolean =>
  error instanceof TypeError &&
  (error.message.startsWith(`Unknown export './${facet}' for `) ||
    error.message == `Module not found "${spec}".`)

/** Whether a plugin exports a subpath, asked of the resolver rather than by
 * importing it: what a process checks before it hands a role to a thread
 * that would only find the facet missing. A plugin named by a path answers
 * yes, since only importing it can tell. */
export let exported = (plugin: string, name: string): boolean => {
  try {
    import.meta.resolve(located(`${plugin}/${name}`))
    return true
  } catch {
    return false
  }
}

/** Where a bare `@yaks/…` name is imported from. Inside a workspace the
 * import map resolves it; a `yak` installed from JSR has no map entry for a
 * package it does not itself import (a plugin a config names, the views of a
 * component another plugin declared), so the name goes to JSR at the release
 * this CLI came from, which keeps every plugin and view one coherent set.
 * `resolve` is `import.meta.resolve`, which throws for a name nothing maps.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let none = (): string => {
 *   throw new TypeError('not a dependency')
 * }
 * assertEquals(located('@yaks/tools/views', none, '1.2.3'), 'jsr:@yaks/tools@1.2.3/views')
 * assertEquals(located('@yaks/tools/views', (s) => s, '1.2.3'), '@yaks/tools/views')
 * assertEquals(located('./plugins/mail/vocab', none, '1.2.3'), './plugins/mail/vocab')
 * ```
 */
export let located = (
  spec: string,
  resolve: (spec: string) => string = import.meta.resolve,
  release: string = cli.version,
): string => {
  if (!spec.startsWith('@yaks/')) return spec
  try {
    resolve(spec)
    return spec
  } catch {
    let [scope, name, ...rest] = spec.split('/')
    return ['jsr:' + scope, `${name}@${release}`, ...rest].join('/')
  }
}

/** `import('<plugin>/<name>')`, or `null` where the package does not export
 * that subpath — a facet, or the `./views` a caller draws with. */
export let subpath = async <M>(
  plugin: string,
  name: string,
): Promise<M | null> => {
  let spec = located(`${plugin}/${name}`)
  try {
    return await import(spec)
  } catch (error) {
    if (unexported(error, spec, name)) return null
    throw error
  }
}

let resolved = (plug: Plug, base: URL): Plug =>
  typeof plug == 'string'
    ? near(plug, base)
    : { ...plug, use: near(plug.use, base) }

/**
 * Read a config file. Paths inside it — the database, a relative plugin — are
 * resolved against the file itself.
 */
export let read = (path: string): Config => {
  let base = new URL(path, `file://${Deno.cwd()}/`)
  let said: unknown
  try {
    said = JSON.parse(Deno.readTextFileSync(base))
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`)
  }
  if (!said || typeof said != 'object' || Array.isArray(said)) {
    throw new Error(`${path}: a config is a JSON object`)
  }
  let config = said as Config
  return {
    ...config,
    db: config.db && config.db != ':memory:'
      ? new URL(config.db, base).pathname
      : config.db,
    plugins: (config.plugins ?? []).map((plug) => resolved(plug, base)),
  }
}
