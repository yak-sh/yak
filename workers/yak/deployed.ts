// What serves a Worker, read from Cloudflare's API with the credentials
// Wrangler holds. A deploy reads its Workers' deployments about nine times;
// each read through Wrangler was a node process of its own, about 2 s of CPU,
// where one `wrangler auth token` now serves them all.
import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { command as spawnCommand } from '@yaks/process/command'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { resent } from '@yaks/cloudflare/api'

export let API = 'https://api.cloudflare.com/client/v4'

/** A Worker's version, as far as a deploy reads one. */
export type Version = { id?: string; annotations?: Record<string, string> }

/** A deploy's reads of what serves, by the Worker's config (from the door's
 * root) and the command's `--env` arguments. A read Cloudflare or the
 * credentials will not answer is undefined; its caller treats it as unread. */
export type Reads = {
  deployments: (config: string, env?: string[]) => Promise<unknown>
  version: (
    config: string,
    id: string,
    env?: string[],
  ) => Promise<Version | undefined>
}

/// environment(['--env', 'staging']) -> 'staging'
/// environment(['-e', 'staging']) -> 'staging'
/// environment(['--env=staging']) -> 'staging'
/// environment([]) -> undefined
/** The environment `--env` arguments name. */
export let environment = (env: string[]): string | undefined => {
  let at = env.findIndex((a) => a == '--env' || a == '-e')
  return at >= 0
    ? env[at + 1]
    : env.find((a) => a.startsWith('--env='))?.slice('--env='.length)
}

type Config = {
  name?: string
  account_id?: string
  env?: Record<string, { name?: string; account_id?: string }>
}

/// script('name="yak"\naccount_id="a"', 'staging').name -> 'yak-staging'
/// script('name="yak"\naccount_id="a"\n[env.staging]\nname="s"', 'staging').name -> 's'
/// script('name="yak"\naccount_id="a"').account -> 'a'
/** The script and account a config names in an environment, as Wrangler
 * resolves them: an environment without a name of its own appends its own. */
export let script = (toml: string, env?: string) => {
  let config = parse(toml) as Config
  let named = env ? config.env?.[env] : undefined
  return {
    account: named?.account_id ?? config.account_id ??
      system.env.get('CLOUDFLARE_ACCOUNT_ID'),
    name: named?.name ?? (env ? `${config.name}-${env}` : config.name),
  }
}

/** The headers Wrangler's own credentials answer with: an API token, an
 * OAuth token it refreshed, or a global key and its email. */
export let credentials = async (
  wrangler: string[],
  cwd: string,
): Promise<Record<string, string>> => {
  let r = await spawnCommand(wrangler[0], {
    args: [...wrangler.slice(1), 'auth', 'token', '--json'],
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!r.success) {
    throw Error(`wrangler auth token: ${new TextDecoder().decode(r.stderr)}`)
  }
  let auth = JSON.parse(new TextDecoder().decode(r.stdout))
  return auth.type == 'api_key'
    ? { 'X-Auth-Key': auth.key, 'X-Auth-Email': auth.email }
    : { Authorization: `Bearer ${auth.token}` }
}

/** {@link Reads} through Cloudflare's API, each config read from `root`. */
export let reads = (
  root: string,
  headers: () => Promise<Record<string, string>>,
  send: (url: string, init: RequestInit) => Promise<Response> = resent,
): Reads => {
  let get = async (config: string, env: string[], path: string) => {
    try {
      let { account, name } = script(
        io.readTextFileSync(join(root, config)),
        environment(env),
      )
      let r = await send(
        `${API}/accounts/${account}/workers/scripts/${name}${path}`,
        { headers: await headers() },
      )
      if (!r.ok) {
        await r.body?.cancel()
        return
      }
      return (await r.json()).result
    } catch {
      return
    }
  }
  return {
    deployments: async (config, env = []) =>
      (await get(config, env, '/deployments'))?.deployments,
    version: (config, id, env = []) =>
      get(config, env, `/versions/${encodeURIComponent(id)}`),
  }
}
