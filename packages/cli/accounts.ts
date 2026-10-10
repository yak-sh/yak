// Remote account credentials come from the configured graph, or a small
// personal graph beside the CLI's other state. Nothing reads a token file.
import type { Served } from './host.ts'
import { configPath, located } from './config.ts'
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
  // Explicit auth creates and installs its personal graph. Ordinary token
  // lookups only open this already-installed file.
  let { compose } = await import('./host.ts')
  let { read } = await import('./config.ts')
  let host = await compose(read(path), ['graph'], undefined, {
    install: true,
    process: false,
  })
  await host.close()
  return path
}
let opened = new Map<string, Promise<Served>>()
/** Account graphs are opened once per command and closed by the CLI's final
 * boundary. Dynamic imports keep an environment-only sandbox off the graph. */
export let accountHost = (path: string): Promise<Served> => {
  let held = opened.get(path)
  if (!held) {
    held = (async () => {
      let { compose } = await import('./host.ts')
      let { read } = await import('./config.ts')
      return compose(read(path), ['graph'])
    })()
    opened.set(path, held)
  }
  return held
}
export let closeAccounts = async (): Promise<void> => {
  let held = [...opened.values()]
  opened.clear()
  for (let host of held) await (await host).close()
}
export type AccountOptions = { config?: string; as?: string; env?: Env }
/** The selected yaks.app connection, or YAKS_TOKEN for a graphless sandbox. */
export let accountToken = async (
  host: string,
  state: string = stateDir(),
  opts: AccountOptions = {},
): Promise<string | null> => {
  let env = opts.env ?? ((name: string) => Deno.env.get(name))
  let explicit = env('YAKS_TOKEN')
  if (explicit) return explicit
  let path = opts.config ?? configPath(undefined, env) ?? personalPath(state)
  try {
    await Deno.stat(path)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null
    throw e
  }
  let { read, used, person } = await import('./config.ts')
  let config = read(path)
  if (!config.person) return null
  let plugins = (config.plugins ?? []).map(used)
  if (!plugins.includes('@yaks/connections')) return null
  let name = new URL((await import('./rpc.ts')).doorUrl(host)).hostname
  // Integrations for other MCP servers are named by resource URL.
  let integration = name == 'yaks.app'
    ? 'yaks.app'
    : (await import('./rpc.ts')).doorUrl(host)
  let direct = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(config.person) ||
    /^(?:[a-z]+-)?[0-9]+$/i.test(config.person)
  if (!opts.as && direct) {
    let { reader } = await import('./reader.ts')
    let r = await reader(
      config,
      plugins.filter((p) =>
        ['@yaks/kernel', '@yaks/id', '@yaks/connections'].includes(p)
      ),
    )
    try {
      let owner = await person({ config, graph: r.graph })
      let found = await r.graph.read(
        `.connection.owner=${owner} .connection.integration=${
          JSON.stringify(integration)
        } .fields=entity.eid .limit=1`,
      )
      if (!found.length) return null
    } finally {
      r.close()
    }
  }
  let h = await accountHost(path)
  let owner = await person(h)
  if (!owner) return null
  let { accountCredential } = await import(located('@yaks/connections'))
  return (await accountCredential(
    { graph: h.graph, vault: h.vault },
    owner,
    integration,
    opts.as,
  ))?.bearer ?? null
}
