// The config file, read. It is the one statement of where a graph is, and it
// says it ONCE: `yak serve` binds the address, and every other `yak` line
// aimed at the same config talks to whatever is listening there.
//
// That is why this is its own module. A line that only needs the ADDRESS must
// not import the host — serve.ts opens a database and pulls in every plugin a
// config names, which is a second copy of the graph a person did not ask for
// and, on a live file, a second writer. So the config is read here, by a
// module that imports nothing.

/** What a config says TO one plugin: its own options, handed to each facet
 * factory beside the host. A value written `{"env": "NAME"}` is read out of
 * the environment when the file is read, so a config names a secret without
 * holding one. */
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
  /** what to listen on, and so where a client aimed at this config talks
   * (default 8787) */
  port?: number
  /** which interface (default Deno's own; a client reads it as the host to
   * talk to, and 127.0.0.1 where it is unsaid or means "everything") */
  hostname?: string
  /** who this host writes as, where no door named a caller — its rules, its
   * effects, the pass each plugin makes at boot. A NAME is the host's own
   * identity: it mints that entity at start-up and derives its id from the
   * name (@yaks/kernel `hosted`), so nothing is looked up. An id this family
   * minted (a uuid, a content hash) names something somebody else made, and
   * is signed with as it stands — a box that writes as a person. */
  actor?: string
  /** whether the store mints human numbers beside eids (default true), and
   * for which entities. `{ except: [comp, …] }` keeps a component's entities
   * off the human number line — what a host composing @yaks/archetype wants,
   * since a descriptor is bookkeeping and nobody ever types its number. */
  numbers?: boolean | { except: string[] }
  /** adopt the `num` a batch's identity carries instead of minting one — what
   * a store seeded from another store's export needs, and never what a host
   * serving clients wants (default false) */
  adopt?: boolean
  /** what the MCP door calls itself (default `yak`) */
  name?: string
}

/** Where a LOCAL host's config is: what the line said, else `$YAK_CONFIG`. */
export let configPath = (said?: string): string | undefined =>
  said ?? Deno.env.get('YAK_CONFIG') ?? undefined

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

// `{"env": "NAME"}` anywhere in an options object is the environment's value
// at the moment the config is read — the one thing a config file cannot hold
// in the open. A name nothing exports reads as undefined rather than as a
// guess, so the plugin refuses in its own words about what it wanted.
let sourced = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sourced)
  if (!value || typeof value != 'object') return value
  let said = value as Record<string, unknown>
  if (typeof said.env == 'string' && Object.keys(said).length == 1) {
    return Deno.env.get(said.env)
  }
  return Object.fromEntries(
    Object.entries(said).map(([k, v]) => [k, sourced(v)]),
  )
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

/** The default port a host binds and a client talks to. */
export let PORT = 8787

/**
 * Where the server this config describes is listening. A `hostname` a host
 * binds may be an interface rather than a name — `0.0.0.0` and `::` mean
 * "everything here", which as an address to TALK to is this box.
 */
export let doorOf = (config: Config): string => {
  let at = config.hostname ?? ''
  let host = !at || at == '0.0.0.0' || at == '::' ? '127.0.0.1' : at
  return `http://${host.includes(':') ? `[${host}]` : host}:${
    config.port ?? PORT
  }`
}

/** The server a line aimed at a config talks to, where the line named no host
 * of its own: the config's address, and nothing when there is no config. */
export let hostOf = (said?: string): string | undefined => {
  let path = configPath(said)
  return path ? doorOf(read(path)) : undefined
}
