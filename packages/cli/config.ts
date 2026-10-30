import { imported as observed, importing } from '@yaks/fp/imports'
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
// module that opens no graph. This package's deno.json supplies the release a
// plugin named without a map entry is taken from (`located`).

import cli from './deno.json' with { type: 'json' }
import { runtimePath } from './runtime.ts'

export type { Config, Options, Plug } from '@yaks/host'
import type { Config, Plug } from '@yaks/host'
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
  runtimePath(
    spec.startsWith('.') || spec.startsWith('/')
      ? new URL(spec, base).href
      : spec,
  )

export { given, used } from '@yaks/host/config'
// A subpath a package does not export is a module it does not have. Anything
// else that goes wrong importing one — a syntax error, a missing dependency, a
// throw at module scope — is that module failing, and is rethrown: a host that
// quietly runs without its rules is worse than one that refuses to start.
let unexported = (error: unknown, spec: string): boolean => {
  if (!(error instanceof TypeError)) return false
  // A failed batched import may be cached with an importer location. Only
  // its first line identifies the missing module; dependencies still differ.
  if (error.message.split('\n', 1)[0] == `Module not found "${spec}".`) {
    return true
  }
  let pkg = /^(?:jsr:)?(@[^/]+\/[^/@]+)(?:@[^/]+)?\/(.+)$/.exec(spec)
  return !!pkg && error.message.startsWith(
    `Unknown export './${pkg[2]}' for '${pkg[1]}'.`,
  )
}

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
  observed(dependencies.get(key) ?? [])
  let known = imported.get(key) as Promise<M | null> | undefined
  if (known) return known
  let asked = optional<M>(key)
  imported.set(key, asked)
  asked.catch(() => imported.delete(key))
  return asked
}
/** Load selected subpaths and required modules as one module graph where the
 * resolver already knows their exports. Deno otherwise builds a separate
 * dependency graph per concurrent dynamic import, rediscovering shared
 * dependencies for each. Module answers follow the subpath answers; only
 * subpaths can be absent. Unmapped JSR packages still use the ordinary loader,
 * which alone can say whether their optional export exists. Nothing is written
 * to disk. */
export let subpaths = async (
  requests: readonly (readonly [plugin: string, name: string])[],
  modules: readonly string[] = [],
): Promise<unknown[]> => {
  let pending: { key: string; spec: string; slot: string }[] = []
  for (let [plugin, name] of requests) {
    let key = `${plugin}/${name}`
    observed(dependencies.get(key) ?? [])
    if (imported.has(key) || pending.some((p) => p.key == key)) continue
    try {
      let spec = import.meta.resolve(key)
      if (!spec.startsWith('file:') || !/\.[cm]?[jt]sx?$/.test(spec)) continue
      dependencies.set(key, [spec])
      pending.push({ key, spec, slot: `m${pending.length}` })
    } catch (error) {
      if (unexported(error, key)) imported.set(key, Promise.resolve(null))
      // An unmapped package is resolved by located() in subpath(), not here.
    }
  }
  let roots = modules.map((spec, index) => ({
    spec: import.meta.resolve(located(spec)),
    slot: `r${index}`,
  }))
  let required: Promise<unknown>[] = []
  if (pending.length || roots.length) {
    let source = [...pending, ...roots].map(({ spec, slot }) =>
      `export * as ${slot} from ${JSON.stringify(spec)};`
    ).join('\n')
    let loading: Promise<Record<string, unknown>> = importing(
      `data:application/javascript,${encodeURIComponent(source)}`,
      [...pending, ...roots].map(({ spec }) => spec),
    )
    for (let { key, slot } of pending) {
      // The batch cannot distinguish an absent file facet from a broken one.
      // Let the ordinary loader classify each on failure, preserving its
      // optional-export semantics and leaving unrelated modules usable.
      let asked = loading.then(
        (modules) => modules[slot],
        () => optional(key),
      )
      imported.set(key, asked)
      asked.catch(() => imported.delete(key))
    }
    required = roots.map(({ spec, slot }) =>
      loading.then(
        (modules) => modules[slot],
        () => importing(spec),
      )
    )
  }
  return await Promise.all(
    [...requests.map(([plugin, name]) => subpath(plugin, name)), ...required],
  )
}

let imported = new Map<string, Promise<unknown>>()
let dependencies = new Map<string, string[]>()
let optional = async <M>(key: string): Promise<M | null> => {
  let spec = located(key)
  try {
    // Missing-module errors name the resolved URL, including for a plugin
    // whose declaring package is an absolute path in a remote vocabulary.
    spec = import.meta.resolve(spec)
    dependencies.set(key, [spec])
    return await importing(spec)
  } catch (error) {
    if (unexported(error, spec)) return null
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
    ...config.sandboxes
      ? {
        sandboxes: {
          ...config.sandboxes,
          providers: Object.fromEntries(
            Object.entries(config.sandboxes.providers ?? {}).map((
              [name, provider],
            ) => [
              name,
              'use' in provider
                ? { ...provider, use: near(provider.use, base) }
                : provider,
            ]),
          ),
        },
      }
      : {},
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
