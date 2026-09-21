// The config file, read. It is the one statement of where a graph IS: the
// SQLite file, the plugins that speak over it, and who the box writes as.
//
// A config names a GRAPH, not a server. `yak --config yak.json task list`
// opens that file, composes those plugins and runs the tool in this process —
// SQLite in WAL mode takes as many writers as there are `yak` lines, so
// nothing has to be listening for a command line to work. `yak serve` is one
// more process over the same file, the one that answers HTTP.
//
// That is why this is its own module. A line that only needs to know WHERE
// must not import the host — serve.ts pulls in every plugin a config names,
// which is a cost a `yak login` should not pay. So the config is read here, by
// a module that imports nothing.

/** What a config says TO one plugin: its own options, handed to each facet
 * factory beside the host. A value written `{"env": "NAME"}` is read out of
 * the environment every time it is asked for, so a config names a secret
 * without holding one — and a facet that re-reads its options sees a key
 * exported after the host booted. */
export type Options = Record<string, unknown>

/** A plugin a config names: a bare specifier, or one with options. */
export type Plug = string | { use: string; with?: Options }

/** What a config file says: where the graph lives, and what speaks over it. */
export type Config = {
  /** the SQLite file, `:memory:` for a graph that lasts as long as the
   * process. Required — a host never guesses a database. */
  db?: string
  /** the plugin modules, by import specifier. A relative one is resolved
   * against the config file itself; `{use, with}` names one with options. */
  plugins?: Plug[]
  /** what `yak serve` listens on (default 8787) */
  port?: number
  /** which interface it binds (default Deno's own) */
  hostname?: string
  /** whether the store mints human numbers beside eids. OPT-IN: unsaid, no
   * entity gets one, because a number is for a person to type and most hosts
   * have nobody typing. `{ except: [comp, …] }` turns them on while keeping a
   * component's entities off the line — what a host composing @yaks/archetype
   * wants, since a descriptor is bookkeeping and nobody ever types its
   * number. */
  numbers?: boolean | { except: string[] }
  /** adopt the `num` a batch's identity carries instead of minting one — what
   * a store seeded from another store's export needs, and never what a host
   * serving clients wants (default false) */
  adopt?: boolean
  /** what the MCP door calls itself (default `yak`) */
  name?: string
  /** how long this process's hold on a DUTY stands before another process may
   * take it, in milliseconds (default 30_000). A holder still doing the work
   * pushes it out on a beat; one that was killed leaves a lease that lapses,
   * which is how a second long-lived process takes over without anybody
   * reaping anything. */
  lease?: number
}

/** Where a box keeps the config for its own graph. */
export let OWN_CONFIG = '.yak/yak.json'

/** The config a line opens: what it said, else `$YAK_CONFIG`, else the one
 * this box keeps for its own graph. A box that HAS a graph is the ordinary
 * case, so a bare `yak task list` there answers from it rather than reaching
 * for a door it was never told about. Nothing there is nothing said. */
export let configPath = (
  said?: string,
  env: (name: string) => string | undefined = Deno.env.get,
): string | undefined => {
  let named = said ?? env('YAK_CONFIG')
  if (named) return named
  let home = env('HOME')
  if (!home) return undefined
  let own = `${home}/${OWN_CONFIG}`
  // A line may be running without read permission at all; that is no config.
  try {
    return Deno.statSync(own).isFile ? own : undefined
  } catch {
    return undefined
  }
}

// A specifier the config file owns — `./plugins/mail`, `/srv/mail` — is
// resolved against the config, so a config is movable and a bare `@yaks/…` is
// left to the import map. It names a PACKAGE, never a file: the facets are its
// subpaths, and only a package has those.
let near = (spec: string, base: URL): string =>
  spec.startsWith('.') || spec.startsWith('/') ? new URL(spec, base).href : spec

/** What a plugin entry names, either way it is written. */
export let used = (plug: Plug): string =>
  typeof plug == 'string' ? plug : plug.use

/** What it was given, either way it is written. */
export let given = (plug: Plug): Options =>
  typeof plug == 'string' ? {} : plug.with ?? {}

// The name `{"env": "NAME"}` says, and nothing else said in that object.
let named = (value: unknown): string | undefined => {
  let said = value as Record<string, unknown> | null
  return said && typeof said == 'object' && typeof said.env == 'string' &&
      Object.keys(said).length == 1
    ? said.env
    : undefined
}

// `{"env": "NAME"}` anywhere in an options object is the environment's value
// AT THE MOMENT IT IS ASKED FOR — the one thing a config file cannot hold in
// the open, and the one thing that can arrive after the host is already up. A
// facet that re-reads its options on each pass therefore starts the moment a
// key is exported, rather than needing the process restarted for a config that
// never changed. A name nothing exports reads as undefined rather than as a
// guess, so the plugin says in its own words what it is waiting for.
let sourced = (value: unknown): unknown => {
  let name = named(value)
  // A whole options object written `{"env": …}` has no parent to hang the
  // reading off, so it is read here and once.
  if (name) return Deno.env.get(name)
  if (!value || typeof value != 'object') return value
  let out = (Array.isArray(value) ? [] : {}) as Record<string, unknown>
  for (let [k, v] of Object.entries(value)) {
    let said = named(v)
    if (said) {
      Object.defineProperty(out, k, {
        get: () => Deno.env.get(said),
        enumerable: true,
        configurable: true,
      })
    } else out[k] = sourced(v)
  }
  return out
}

let resolved = (plug: Plug, base: URL): Plug =>
  typeof plug == 'string' ? near(plug, base) : {
    use: near(plug.use, base),
    ...plug.with ? { with: sourced(plug.with) as Options } : {},
  }

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

/** The default port `yak serve` binds. */
export let PORT = 8787
