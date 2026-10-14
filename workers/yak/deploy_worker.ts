// The files are staged when a release arrives here. Config and account
// capabilities are checked before any upload, so a refused resource never
// publishes a worker with only half of its requested bindings.
import { type App, type Space, storeName } from './directory.ts'
import { carried, drop, NEEDS_TOKEN, upload, WORKER } from './dispatch.ts'
import type { Env } from './env.ts'
import {
  bindingLines,
  bindings,
  discard,
  provision,
  retained,
} from './bindings.ts'
import { type Config, idReport, parse, type Parsed } from './wrangler_app.ts'
import type { Compiled } from './esbuild.ts'
import { meta } from './meta.ts'
import { refuse } from './tool.ts'
import { caught } from './defects.ts'
import { rebind } from './connections.ts'
import { scriptName } from './dispatch.ts'

type Read = (path: string) => Promise<Uint8Array<ArrayBuffer> | null>

export let configured = async (read: Read) => {
  let jsonc = await read('wrangler.jsonc')
  let json = await read('wrangler.json')
  let bytes = jsonc ?? json
  let parsed = parse(bytes ? new TextDecoder().decode(bytes) : '{}')
  if (jsonc && json) {
    parsed.report.push('ignored wrangler.json: wrangler.jsonc takes precedence')
  }
  return parsed
}

// Why a `vpc_services` door cannot reach the machine the app's space has a
// tunnel to, or null when it can; tunnel.ts `reach` asks again on every
// request. Only an app built in the space reaches it: an installed copy's code
// was written elsewhere, and a tunnel reaches into the owner's own machine.
let unreached = (space: Space, app: App, config: Config) =>
  !config.vpc_services?.length
    ? null
    : app.installed
    ? `refused vpc_services: ${app.slug} is an installed copy, and only an app built in ${space.slug} reaches the machine its tunnel goes to`
    : !space.tunnel
    ? `refused vpc_services: ${space.slug} has no tunnel to a machine; its owner makes one first`
    : null

/**
 * The app's worker, deployed: `parsed` is its wrangler config as
 * {@link configured} read it, and `compiled` the worker the release's compile
 * step made of a source that needed one (esbuild.ts), uploaded in place of
 * the source's own modules.
 */
export let deployWorker = async (
  env: Env,
  space: Space,
  app: App,
  read: Read,
  parsed: Parsed,
  compiled?: Compiled['worker'],
) => {
  let store = storeName(space, app)
  let target = app.script ?? store
  let { config, report } = parsed
  let refused = [...parsed.refused]
  let why = unreached(space, app, config)
  if (why) refused.push(why)
  let held = await bindings(env, app)
  let worker = ''
  let unchanged = 'the files remain staged; the prior worker is unchanged'
  let main = compiled?.source ?? config.main ?? WORKER
  let has = compiled != null || await read(main) != null
  if (!has && config.main) {
    refused.push(
      `refused main: ${main} is not an app file; upload the server source at that path`,
    )
  }
  let ids = idReport(config, held)
  if (refused.length) {
    return {
      worker,
      ready: false,
      lines: [...report, ...ids, ...refused, unchanged, ...bindingLines(held)],
    }
  }
  // A release with no server source has no worker: its script name is its
  // own and nothing was uploaded under it, so serving finds no script and
  // answers from the files. The prior release's script stays for a rollback,
  // and there is nothing to remove (T-124005: removing this release's
  // never-made script was one call to Cloudflare per deploy, up to 4.6 s).
  if (!has) {
    return {
      worker,
      ready: true,
      lines: [...report, ...ids, ...refused, ...retained(held, {})],
    }
  }
  if (!env.CF_WORKERS_TOKEN) {
    return {
      worker,
      ready: false,
      lines: [...report, ...ids, NEEDS_TOKEN, ...bindingLines(held)],
    }
  }
  let bound
  let modules = compiled?.modules ?? await carried(read, config.main)
  try {
    bound = await provision(env, app, store, config)
  } catch (e) {
    if (!(await meta(env).query(`.entity.eid=${app.eid}&.app`)).length) throw e
    caught(e, { request: 'deploy worker', app: app.slug })
    held = await bindings(env, app)
    let why = e instanceof Error ? e.message : String(e)
    return {
      worker,
      ready: false,
      lines: [
        ...report,
        ...idReport(config, held),
        `refused: ${why}`,
        unchanged,
        ...bindingLines(held),
      ],
    }
  }
  // Cloudflare's id for what was uploaded, or its script name where the API
  // answered none: never empty once something is up, since an empty worker
  // is a release that built none, and its pages ask for no worker at all
  // (dispatch.ts `called`).
  worker = await upload(
    env,
    target,
    modules,
    compiled ? { ...config, main: compiled.main } : config,
    bound,
    target == store ? undefined : scriptName(store),
  ) || scriptName(target)
  // What its code reads as env.NAME: a first upload is the first script there
  // is to bind the app's connections to (connections.ts). The worker is up
  // either way, so a binding that did not take is ours to hear about.
  try {
    await rebind(env, target, app.eid)
  } catch (e) {
    caught(e, { request: 'rebind', app: app.slug })
    if (target != store) throw e
  }
  // An upload can finish after permanent deletion's script DELETE. Reconcile
  // that late effect while its ids are still in hand, before recording a release.
  if (!(await meta(env).query(`.entity.eid=${app.eid}&.app`)).length) {
    await drop(env, target, true)
    for (let binding of bound) await discard(env, binding)
    throw refuse(
      'conflict',
      'the app was permanently deleted during its worker upload',
    )
  }
  return {
    worker,
    ready: true,
    lines: [
      ...report,
      ...idReport(config, bound),
      `worker: ${main} answers first; a 404 from it serves the files (main is the server source; default worker.js, else worker.ts; the upload wrapper is platform-owned)`,
      ...bindingLines(bound),
      ...retained(held, config),
    ],
  }
}
