// What serves a Worker: its deployments and versions, read from Cloudflare's
// API with the credentials Wrangler holds, and what a deployment says about
// the commit it serves. A deploy reads its Workers' deployments about nine
// times; each read through Wrangler was a node process of its own, about 2 s
// of CPU, where one `wrangler auth token` now serves them all.
import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { command as spawnCommand } from '@yaks/process/command'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { type Account, accountUrl, resent } from './api.ts'

/** A Worker's version, as far as a deploy reads one. */
export type Version = { id?: string; annotations?: Record<string, string> }

/** One of a Worker's deployments: which versions serve what share of its
 * traffic, since when, and its annotations (`workers/message`,
 * `workers/triggered_by`). */
export type Deployment = {
  id?: string
  created_on: string
  versions: { version_id: string; percentage: number }[]
  annotations?: Record<string, string>
}

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

/// envs(['deploy', '--env', 's', '-c', 'a.toml']) -> ['--env', 's']
/// envs(['--env=s', 'deploy']) -> ['--env=s']
/** A command's `--env` arguments, as it wrote them. */
export let envs = (args: string[]): string[] =>
  args.flatMap((a, i) =>
    a == '--env' || a == '-e'
      ? [a, args[i + 1]]
      : a.startsWith('--env=')
      ? [a]
      : []
  )

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

/** {@link Reads} through Cloudflare's API, each config read from `root`;
 * `WORKERS_API` aims them at a stand-in, as it does every account call. */
export let reads = (
  root: string,
  headers: () => Promise<Record<string, string>>,
  send: (url: string, init: RequestInit) => Promise<Response> = resent,
  { WORKERS_API }: Pick<Account, 'WORKERS_API'> = {},
): Reads => {
  let get = async (config: string, env: string[], path: string) => {
    try {
      let { account, name } = script(
        io.readTextFileSync(join(root, config)),
        environment(env),
      )
      let r = await send(
        accountUrl(
          { CF_ACCOUNT: account, WORKERS_API },
          `/workers/scripts/${name}${path}`,
        ),
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

/// shaIn('739f56b25cae820c8541a8b4a1ade2f7a6c7e9be A release module…') -> '739f56b25cae820c8541a8b4a1ade2f7a6c7e9be'
/// shaIn('yaks.app emergency rollback to 739f56b2: build path broken') -> undefined
/** The commit a version's or deployment's message leads with, written in full
 * by a deploy door (./wrangler `versionMessage`). */
export let shaIn = (message?: string): string | undefined =>
  message?.match(/^([a-f\d]{40})\b/i)?.[1].toLowerCase()

/// messageOf({ annotations: { 'workers/message': 'm' } }) -> 'm'
/// messageOf(undefined) -> ''
/** A version's or deployment's message, or nothing. */
export let messageOf = (
  release: { annotations?: Record<string, string> } | null | undefined,
) => {
  let message = release?.annotations?.['workers/message']
  return typeof message == 'string' ? message : ''
}

/** The newest of a Worker's deployments. */
export let newest = <T extends { created_on: string }>(
  deployments: T[],
): T | undefined =>
  deployments.toSorted((a, b) =>
    Date.parse(b.created_on) - Date.parse(a.created_on)
  )[0]

/// sole([{ created_on: '2026-01-01', versions: [{ version_id: 'a', percentage: 100 }] }])?.versions[0].version_id -> 'a'
/// sole([{ created_on: '2026-01-01', versions: [{ version_id: 'a', percentage: 50 }, { version_id: 'b', percentage: 50 }] }]) -> undefined
/// sole('unread') -> undefined
/** The newest deployment, when it gives one version all the traffic; nothing
 * for a split, or for an answer that is not a list of deployments. */
export let sole = (deployments: unknown): Deployment | undefined => {
  if (
    !Array.isArray(deployments) ||
    deployments.some((d) =>
      !d || typeof d != 'object' || !Number.isFinite(Date.parse(d.created_on))
    )
  ) return
  let now = newest(deployments as Deployment[])
  return Array.isArray(now?.versions) && now.versions.length == 1 &&
      now.versions[0]?.percentage == 100
    ? now
    : undefined
}

/** What serves now: the newest deployment's leading version, the commit its
 * message names (a rollback's or a split's names none; its versions' do),
 * when it went live, whether an operator rolled back to it, and every version
 * that takes a share of its traffic, the largest first. */
export let serving = (deployments: Deployment[]) => {
  let now = newest(deployments)
  let shares = now?.versions.toSorted((a, b) => b.percentage - a.percentage)
  return now && shares?.length
    ? {
      version: shares[0].version_id,
      versions: shares.filter((v) => v.percentage > 0).map((v) => v.version_id),
      sha: now.versions.length == 1 ? shaIn(messageOf(now)) : undefined,
      at: now.created_on,
      rollback: now.annotations?.['workers/triggered_by'] == 'rollback',
    }
    : undefined
}

/** The commits the versions live now were deployed from, in the environment
 * `env` names, as the message a deploy door gives each says: the newest
 * deployment's, or each serving version's when that names none. Anything
 * Cloudflare will not answer names no commit. */
export let commits = async (
  read: Reads,
  config: string,
  env: string[] = [],
): Promise<string[]> => {
  let all = await read.deployments(config, env)
  let now = serving(Array.isArray(all) ? all as Deployment[] : [])
  if (now?.sha) return [now.sha]
  let named = await Promise.all(
    (now?.versions ?? []).map(async (id) =>
      shaIn(messageOf(await read.version(config, id, env)))
    ),
  )
  return named.filter((sha) => sha != null)
}
