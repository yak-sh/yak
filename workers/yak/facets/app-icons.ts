import type { Handlers } from '@yaks/effects'
import type { Directory, OnOffer } from '../directory.ts'
import { stamp } from '../directory.ts'
import type { Env } from '../env.ts'
import type { Stored } from '../graph.ts'
import { fileBytes, prefixOf } from '../files.ts'
import { r2RawObjects } from '../lib/objects.ts'
import { drawn } from '../raster.ts'
import { agents, operatorProviders } from '../config.ts'
import { platform, ready, served } from '../providers.ts'
import { BASE, namedBy } from '@yaks/platform/operator-model'
import {
  drawIcon,
  ensureIcon,
  generatedIconKey,
  ICON_PNG,
  type IconApp,
  type IconPage,
} from '@yaks/platform/app-icon'
import { audit } from '../admin-action.ts'
import type { Who } from '../session.ts'
import { singleFlight } from '@yaks/fp'

let released = ({ app, space }: OnOffer) =>
  (app.version ?? 0) > 0 && !app.trashed && !space.trashed

let authored = async (env: Env, { app, space }: OnOffer) => {
  let response = await fileBytes(
    env,
    app.eid,
    prefixOf(space, app),
    `/${ICON_PNG}`,
    app.source ?? '',
  )
  await response.body?.cancel()
  if (response.status >= 500) {
    throw new Error(`App icon read: ${response.status}`)
  }
  return response.ok && response.headers.get('content-type') == 'image/png'
}

let draw = async (env: Env, store: Stored, app: IconApp, eid: string) => {
  let models = served(env, () => platform(env), operatorProviders)
  let base = await namedBy(store.graph, BASE)
  let choices = [
    ...base ? [base] : [],
    ...agents.operator,
  ]
  let chosen = choices.find(({ provider }) =>
    models[provider] && ready(env, provider, operatorProviders)
  )
  if (!chosen) throw new Error('No hosted Operator model can draw an app icon')
  return drawIcon(
    models[chosen.provider],
    chosen.model,
    app,
    (svg) => drawn(env, svg, eid),
  )
}

export let drawingIcons = (store: Stored, dir: Directory): Handlers => {
  if (!store.env.RASTER || !store.env.BLOBS) return {}
  let env = store.env as Env
  let raw = r2RawObjects(env.BLOBS)
  // One drawing at a time for each app, within this object.
  let drawing = singleFlight(() => store)
  return {
    app_icon_draw: async ({ entity }, _tx, write, attempt) => {
      let record = async () =>
        await write([{
          entity,
          app_icon: { drawn: new Date(store.now()).toISOString() },
        }])
      let work = () =>
        ensureIcon({
          live: async () => {
            let at = await dir.appAt(entity.eid)
            return at && released(at) ? at : null
          },
          authored: (at) => authored(env, at),
          has: raw.has,
          draw: (app) => draw(env, store, app, entity.eid),
          put: raw.put,
          record: () => attempt?.retry ? attempt.retry(record) : record(),
        })
      await drawing(store, entity.eid, work)
    },
  }
}

export let appIcons = async (
  req: Request,
  env: Env,
  dir: Directory,
  who: Who,
): Promise<Response> => {
  if (!['GET', 'POST'].includes(req.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
  }
  let params = new URL(req.url).searchParams
  let after = params.get('after') ?? ''
  let of = params.get('owner_of')
  let reference = of ? await dir.space(of) : null
  if (of && !reference) {
    return Response.json({ message: 'Unknown space' }, { status: 404 })
  }
  let spaces = reference
    ? [...(await dir.standing(await dir.owners(reference))).values()].flat()
    : await dir.all()
  let byId = new Map(spaces.map((space) => [space.eid, space]))
  let apps = (await dir.apps([...byId.values()])).flatMap((app) => {
    let space = byId.get(app.space)
    return space && app.eid > after && released({ app, space })
      ? [{ app, space }]
      : []
  }).sort((a, b) => a.app.eid.localeCompare(b.app.eid))
  let size = 16
  let raw = r2RawObjects(env.BLOBS)
  let page = await Promise.all(
    apps.slice(0, size).map(async (at) => {
      let { app, space } = at
      let icon: IconPage['apps'][number]['icon'] = await authored(env, at)
        ? 'authored'
        : app.generatedIcon && await raw.has(generatedIconKey(space, app))
        ? 'generated'
        : 'missing'
      let splash = !!app.splash
      return { eid: app.eid, space: space.slug, app: app.slug, icon, splash }
    }),
  )
  // An app drawn an icon is drawn its splash after it, so only an app whose
  // icon stands is asked for its splash here.
  let missing = page.filter((app) => app.icon == 'missing')
  let bare = page.filter((app) => app.icon != 'missing' && !app.splash)
  let queued = 0
  if (req.method == 'POST' && (missing.length || bare.length)) {
    if (!env.RASTER) {
      return Response.json({ message: 'Icon drawing is unavailable' }, {
        status: 503,
      })
    }
    await audit(env, who, {
      operation: 'app icon backfill',
      target: after || undefined,
    })
    let requested = new Date(env.CLOCK?.now() ?? Date.now()).toISOString()
    await stamp(env, {
      entities: [
        ...missing.map(({ eid }) => ({
          entity: { eid },
          app_icon: { requested },
        })),
        ...bare.map(({ eid }) => ({
          entity: { eid },
          app_splash: { requested },
        })),
      ],
    })
    queued = missing.length + bare.length
  }
  return Response.json(
    {
      apps: page,
      next: apps.length > size ? page.at(-1)!.eid : null,
      queued,
    } satisfies IconPage,
    { headers: { 'cache-control': 'private, no-store' } },
  )
}
