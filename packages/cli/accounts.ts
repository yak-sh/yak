// Remote account credentials come from the configured graph, or a small
// personal graph beside the CLI's other state. Nothing reads a token file.
import type { Served } from './host.ts'
import {
  type Config,
  configPath,
  dbOf,
  located,
  person,
  read,
  used,
} from './config.ts'
import type { Reader } from './reader.ts'
import { type Env, stateDir } from './store.ts'

export let personalPath = (state: string): string => `${state}/accounts.json`
/** Make the personal graph only on explicit auth. Domain plugins are secrets
 * and connections; core vocabulary, stamps and sealing effects are plumbing. */
export let personal = async (state: string = stateDir()): Promise<string> => {
  let path = personalPath(state)
  try {
    await Deno.stat(path)
    return path
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  await Deno.mkdir(state, { recursive: true, mode: 0o700 })
  let person = crypto.randomUUID()
  await Deno.writeTextFile(
    path,
    JSON.stringify(
      {
        db: `${state}/accounts.db`,
        person,
        plugins: [
          '@yaks/kernel',
          '@yaks/provenance',
          '@yaks/edge',
          '@yaks/doc',
          '@yaks/effects',
          '@yaks/secrets',
          '@yaks/connections',
        ],
      },
      null,
      2,
    ) + '\n',
    { createNew: true, mode: 0o600 },
  )
  // Explicit auth creates its personal graph; opening it to write adds the
  // schema. Ordinary token lookups only read this file.
  let { compose } = await import('./host.ts')
  let { read } = await import('./config.ts')
  let host = await compose(read(path), ['graph'], undefined, {
    process: false,
  })
  await host.close()
  return path
}
type AccountHost = Pick<Served, 'config' | 'vault' | 'close'> & {
  graph: Pick<Served['graph'], 'read' | 'address' | 'apply'>
}
// @yaks/connections' accountCredential, loaded by name: the CLI states the
// door it uses, since importing the type would make the packages a cycle.
type Credential = (
  ctx: Pick<AccountHost, 'graph' | 'vault'>,
  owner: string,
  integration: string,
  as?: string,
) => Promise<{ bearer: string } | undefined>

/** The doors account selection needs: configuration, a read-only graph,
 * and a writable host opened only for a matching connection. */
export type AccountDoors<H extends AccountHost = AccountHost> = {
  config: (path: string) => Config | undefined | Promise<Config | undefined>
  reader: (config: Config, plugins: string[]) => Promise<Reader>
  host: (path: string) => Promise<H>
  credential: Credential
}

/** One command's account handles. Only handles are kept; each lookup reads
 * current connections and credentials, including ones added after a miss. */
/** What one command holds: its account graphs and their tokens. */
export type Accounts<H> = {
  host: (path: string) => Promise<H>
  close: () => Promise<void>
  token: (
    hostName: string,
    state?: string,
    opts?: AccountOptions,
  ) => Promise<string | null>
}

export let accounts = <H extends AccountHost>(
  doors: AccountDoors<H>,
): Accounts<H> => {
  let opened = new Map<string, Promise<H>>()
  let readers = new Map<string, Promise<Reader>>()
  let accountReader = (config: Config, plugins: string[]) => {
    let key = JSON.stringify([dbOf(config), plugins])
    let held = readers.get(key)
    if (!held) {
      held = doors.reader(config, plugins)
      readers.set(key, held)
      held.catch(() => readers.delete(key))
    }
    return held
  }
  let host = (path: string): Promise<H> => {
    let held = opened.get(path)
    if (!held) {
      held = doors.host(path)
      opened.set(path, held)
    }
    return held
  }
  let close = async (): Promise<void> => {
    let held = [...opened.values()]
    let read = [...readers.values()]
    opened.clear()
    readers.clear()
    for (let r of read) (await r).close()
    for (let h of held) await (await h).close()
  }
  let token = async (
    hostName: string,
    state: string = stateDir(),
    opts: AccountOptions = {},
  ): Promise<string | null> => {
    let env = opts.env ?? ((name: string) => Deno.env.get(name))
    let explicit = env('YAKS_TOKEN')
    if (explicit) return explicit
    let path = opts.config ?? configPath(undefined, env) ?? personalPath(state)
    let config = await doors.config(path)
    if (!config?.person) return null
    let plugins = (config.plugins ?? []).map(used)
    if (!plugins.includes('@yaks/connections')) return null
    let url = (await import('./rpc.ts')).doorUrl(hostName)
    let integration = new URL(url).hostname == 'yaks.app' ? 'yaks.app' : url
    let direct =
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config.person) ||
      /^(?:[a-z]+-)?[0-9]+$/i.test(config.person)
    if (!opts.as && direct) {
      let r = await accountReader(
        config,
        // A prefixed ID is checked against every kind its owner carries. Its
        // defining vocabulary may belong to any configured plugin.
        /^[a-z]+-[0-9]+$/i.test(config.person)
          ? plugins
          : plugins.filter((p) =>
            [
              '@yaks/kernel',
              '@yaks/provenance',
              '@yaks/id',
              '@yaks/connections',
            ].includes(p)
          ),
      )
      let owner = await person({ config, graph: r.graph })
      let found = await r.graph.read(
        `.connection.owner=${owner} .connection.integration=${
          JSON.stringify(integration)
        } .fields=entity.eid .limit=1`,
      )
      if (!found.length) return null
    }
    let h = await host(path)
    let owner = await person(h)
    if (!owner) return null
    return (await doors.credential(
      { graph: h.graph, vault: h.vault },
      owner,
      integration,
      opts.as,
    ))?.bearer ?? null
  }
  return { host, close, token }
}

let command: Accounts<Served> = accounts({
  config: async (path) => {
    try {
      await Deno.stat(path)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return undefined
      throw e
    }
    return read(path)
  },
  reader: (config, plugins) =>
    import('./reader.ts').then(({ reader }) => reader(config, plugins)),
  host: async (path) => {
    let { compose } = await import('./host.ts')
    return compose(read(path), ['graph'])
  },
  credential: async (...args) => {
    let { accountCredential } = await import(located('@yaks/connections'))
    return accountCredential(...args)
  },
})

/** Account graphs are opened once per command and closed by the CLI's final
 * boundary. Dynamic imports keep an environment-only sandbox off the graph. */
export let accountHost = command.host
export let closeAccounts = command.close
export type AccountOptions = { config?: string; as?: string; env?: Env }
/** The selected yaks.app connection, or YAKS_TOKEN for a graphless sandbox. */
export let accountToken = command.token
