// The files already serve when a release arrives here. Config and account
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
import { type Config, idReport, parse } from './wrangler_app.ts'
import { meta } from './meta.ts'
import { refuse } from './tool.ts'
import { caught } from './sentry.ts'
import { rebind } from './connections.ts'

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

// Why a `vpc_services` binding cannot reach the machine linked to the app's
// space, or null when it can. Only an app built in the space reaches it: an
// installed copy's code was written elsewhere, and a link reaches into the
// owner's own machine.
let unreached = (space: Space, app: App, config: Config) =>
  !config.vpc_services?.length
    ? null
    : app.installed
    ? `refused vpc_services: ${app.slug} is an installed copy, and only an app built in ${space.slug} reaches the machine linked to it`
    : !space.tunnel
    ? `refused vpc_services: no machine is linked to ${space.slug}; its owner links one first`
    : null

export let deployWorker = async (
  env: Env,
  space: Space,
  app: App,
  read: Read,
) => {
  let store = storeName(space, app)
  let { config, report, refused } = await configured(read)
  let why = unreached(space, app, config)
  if (why) refused.push(why)
  let held = await bindings(env, app)
  let worker = ''
  let unchanged = 'the files are deployed and serving; the worker is unchanged'
  let main = config.main ?? WORKER
  let source = await read(main)
  if (!source && config.main) {
    refused.push(
      `refused main: ${main} is not an app file; upload the server source at that path`,
    )
  }
  let ids = idReport(config, held)
  if (refused.length) {
    return {
      worker,
      lines: [...report, ...ids, ...refused, unchanged, ...bindingLines(held)],
    }
  }
  if (!source) {
    if (env.CF_WORKERS_TOKEN) await drop(env, store)
    else if (held.length) {
      return {
        worker,
        lines: [
          ...report,
          ...ids,
          'refused: CF_WORKERS_TOKEN is missing; the prior worker and its bindings are unchanged',
          ...bindingLines(held),
        ],
      }
    }
    return {
      worker,
      lines: [...report, ...ids, ...refused, ...retained(held, {})],
    }
  }
  if (!env.CF_WORKERS_TOKEN) {
    return {
      worker,
      lines: [...report, ...ids, NEEDS_TOKEN, ...bindingLines(held)],
    }
  }
  let bound
  let modules = await carried(read, config.main)
  try {
    bound = await provision(env, app, store, config)
  } catch (e) {
    if (!(await meta(env).query(`.eid=${app.eid}&.app`)).length) throw e
    caught(e, { request: 'deploy worker', app: app.slug })
    held = await bindings(env, app)
    let why = e instanceof Error ? e.message : String(e)
    return {
      worker,
      lines: [
        ...report,
        ...idReport(config, held),
        `refused: ${why}`,
        unchanged,
        ...bindingLines(held),
      ],
    }
  }
  worker = await upload(
    env,
    store,
    modules,
    config,
    bound,
    space.tunnel?.service,
  )
  // What its code reads as env.NAME: a first upload is the first script there
  // is to bind the app's connections to (connections.ts). The worker is up
  // either way, so a binding that did not take is ours to hear about.
  await rebind(env, store, app.eid).catch((e) =>
    caught(e, { request: 'rebind', app: app.slug })
  )
  // An upload can finish after permanent deletion's script DELETE. Reconcile
  // that late effect while its ids are still in hand, before recording a release.
  if (!(await meta(env).query(`.eid=${app.eid}&.app`)).length) {
    await drop(env, store, true)
    for (let binding of bound) await discard(env, binding)
    throw refuse(
      'conflict',
      'the app was permanently deleted during its worker upload',
    )
  }
  return {
    worker,
    lines: [
      ...report,
      ...idReport(config, bound),
      `worker: ${main} answers first; a 404 from it serves the files (main is the server source; default worker.js; the upload wrapper is platform-owned)`,
      ...bindingLines(bound),
      ...retained(held, config),
    ],
  }
}
