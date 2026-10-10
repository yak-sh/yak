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

export type { Config, Options, Plug } from '@yaks/host'
import type { Config, Options, Plug } from '@yaks/host'
import type { Eid, Graph } from '@yaks/graph'

/** Where a machine keeps the config for its own graph. */
export let OWN_CONFIG = '.yak/yak.json'

/** The person who works at this machine, as the entity the config's `person`
 * names, or nobody where it names none: a machine never guesses who is at its
 * keyboard. What they type at it is written by them. */
export let person = async (
  host: { config: Pick<Config, 'person'>; graph: Pick<Graph, 'address'> },
): Promise<Eid | undefined> => {
  let said = host.config.person
  return said ? (await host.graph.address([said])).get(said) ?? said : undefined
}

/** Where this machine keeps the config for its own graph, whether or not it
 * has one yet: under `$HOME`, or nowhere for a process that has none. */
export let ownConfig = (
  env: (name: string) => string | undefined = Deno.env.get,
): string | undefined => {
  let home = env('HOME')
  return home ? `${home}/${OWN_CONFIG}` : undefined
}

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
  let own = ownConfig(env)
  if (!own) return undefined
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
 * that subpath — a facet, or the `./views` a caller draws with. Each answer is
 * asked for once: a module is imported once a process whoever asks, and a
 * subpath a package does not export stays unexported, where finding that out
 * again costs an import that throws. */
export let subpath = <M>(plugin: string, name: string): Promise<M | null> => {
  let key = `${plugin}/${name}`
  let known = imported.get(key) as Promise<M | null> | undefined
  if (known) return known
  let asked = importing<M>(key, name)
  imported.set(key, asked)
  asked.catch(() => imported.delete(key))
  return asked
}
/** Load selected subpaths as one module graph where the resolver already
 * knows their exports. Deno otherwise builds a separate dependency graph per
 * concurrent dynamic import, rediscovering shared dependencies for each.
 * Unmapped JSR packages still use the ordinary loader, which alone can say
 * whether their optional export exists. Nothing is written to disk. */
export let subpaths = async (
  requests: readonly (readonly [plugin: string, name: string])[],
): Promise<unknown[]> => {
  let pending: { key: string; name: string; spec: string; slot: string }[] = []
  for (let [plugin, name] of requests) {
    let key = `${plugin}/${name}`
    if (imported.has(key) || pending.some((p) => p.key == key)) continue
    try {
      let spec = import.meta.resolve(key)
      if (!spec.startsWith('file:') || !/\.[cm]?[jt]sx?$/.test(spec)) continue
      pending.push({ key, name, spec, slot: `m${pending.length}` })
    } catch (error) {
      if (unexported(error, key, name)) imported.set(key, Promise.resolve(null))
      // An unmapped package is resolved by located() in subpath(), not here.
    }
  }
  if (pending.length) {
    let source = pending.map(({ spec, slot }) =>
      `export * as ${slot} from ${JSON.stringify(spec)};`
    ).join('\n')
    let loading: Promise<Record<string, unknown>> = import(
      `data:application/javascript,${encodeURIComponent(source)}`
    )
    for (let { key, slot } of pending) {
      let name = requests.find(([plugin, name]) =>
        `${plugin}/${name}` == key
      )![1]
      // The batch cannot distinguish an absent file facet from a broken one.
      // Let the ordinary loader classify each on failure, preserving its
      // optional-export semantics and leaving unrelated modules usable.
      let asked = loading.then(
        (modules) => modules[slot],
        () => importing(key, name),
      )
      imported.set(key, asked)
      asked.catch(() => imported.delete(key))
    }
  }
  return await Promise.all(
    requests.map(([plugin, name]) => subpath(plugin, name)),
  )
}

let imported = new Map<string, Promise<unknown>>()
let importing = async <M>(key: string, name: string): Promise<M | null> => {
  let spec = located(key)
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
    ...config.tracker
      ? {
        tracker: {
          ...config.tracker,
          spool: new URL(config.tracker.spool, base).pathname,
        },
      }
      : {},
    db: config.db && config.db != ':memory:'
      ? new URL(config.db, base).pathname
      : config.db,
    plugins: (config.plugins ?? []).map((plug) => resolved(plug, base)),
  }
}

/** The database a config names. `DB_PATH` is the other way to give it, for a
 * service file that would rather set it in the environment. Neither has a
 * default, because the path anybody would pick as one is somebody's live
 * graph. */
export let dbOf = (
  config: Config,
  env: (name: string) => string | undefined = (n) => Deno.env.get(n),
): string => {
  let db = config.db ?? env('DB_PATH')
  if (!db) {
    throw new Error(
      'a host needs a database: `db` in the config, or DB_PATH in the ' +
        'environment — there is no default',
    )
  }
  return db
}
