// An app's splash images (@yaks/platform/splash), drawn by yak-raster when a
// release, the app's colours or its generated icon change, and kept beside
// its generated icon. Never drawn on a request: a page names a set only once
// it is recorded on the app.
import type { Handlers } from '@yaks/effects'
import type { Directory, OnOffer } from '../directory.ts'
import type { Env } from '../env.ts'
import type { Stored } from '../graph.ts'
import { fileBytes, prefixOf } from '../files.ts'
import { r2RawObjects } from '../lib/objects.ts'
import { pictured } from '../raster.ts'
import { generatedIconKey, ICON_PNG } from '@yaks/platform/app-icon'
import { MANIFEST } from '@yaks/platform/routes'
import { ensureSplash, pageSheets, palette } from '@yaks/platform/splash'
import { sharing } from '@yaks/fp'
import { defect } from '../defects.ts'

let released = ({ app, space }: OnOffer) =>
  (app.version ?? 0) > 0 && !app.trashed && !space.trashed

// The most of a page's sheets read, and of each one's bytes.
let SHEETS = 48
let LARGEST = 512 * 1024

/** What an app's set is drawn from: the icon its home screen wears, and its
 * background as its owner, its manifest or its start page's sheets say. */
let inputs = async (
  env: Env,
  raw: ReturnType<typeof r2RawObjects>,
  { space, app }: OnOffer,
) => {
  let file = async (path: string) => {
    let r = await fileBytes(
      env,
      app.eid,
      prefixOf(space, app),
      path,
      app.source ?? '',
    )
    if (r.status >= 500) throw new Error(`App file read ${path}: ${r.status}`)
    if (!r.ok) {
      await r.body?.cancel()
      return null
    }
    return r
  }
  let text = async (path: string) => {
    let r = await file(path)
    if (!r) return null
    let body = new Uint8Array(await r.arrayBuffer())
    return body.length > LARGEST ? null : new TextDecoder().decode(body)
  }
  let own = await file(`/${ICON_PNG}`)
  let icon = own?.headers.get('content-type') == 'image/png'
    ? new Uint8Array(await own.arrayBuffer())
    : (await own?.body?.cancel(), null)
  icon ??= app.generatedIcon
    ? await raw.read(generatedIconKey(space, app))
    : null
  icon ??= new Uint8Array(
    await (await env.ASSETS.fetch(
      new Request('https://assets.invalid/connector-512.png'),
    ))
      .arrayBuffer(),
  )
  let manifest = null
  try {
    manifest = JSON.parse(await text(`/${MANIFEST}`) ?? 'null')
  } catch { /* a manifest that is not JSON says no colour */ }
  let page = await text('/index.html')
  let sheets: string[] = []
  for (let sheet of pageSheets(page ?? '').slice(0, SHEETS)) {
    let at = 'href' in sheet
      ? new URL(sheet.href, 'https://app.invalid/')
      : null
    sheets.push(
      'text' in sheet
        ? sheet.text
        : at?.origin == 'https://app.invalid'
        ? await text(decodeURIComponent(at.pathname)) ?? ''
        : '',
    )
  }
  return {
    icon,
    palette: palette({
      theme: app.theme?.backgroundColor,
      manifest: manifest && typeof manifest == 'object' ? manifest : null,
      sheets,
    }),
  }
}

// Each app's set is drawn one image at a time (@yaks/platform/splash
// `ensureSplash`), so the directory's pool, which bounds how many runs go at
// once, bounds how many drawings do: sixteen apps drawing six images each held
// the directory's connections, and its own requests waited behind them for up
// to a minute.
export let drawingSplashes = (store: Stored, dir: Directory): Handlers => {
  if (!store.env.RASTER || !store.env.BLOBS) return {}
  let env = store.env as Env
  let raw = r2RawObjects(env.BLOBS)
  let pending = new Map<string, Promise<unknown>>()
  return {
    app_splash_draw: async ({ entity }, _tx, write, attempt) => {
      let record = (drawn: { key: string; dark: boolean }) => async () =>
        await write([{ entity, app_splash: drawn }])
      let work = () =>
        ensureSplash({
          live: async () => {
            let at = await dir.appAt(entity.eid)
            return at && released(at) ? at : null
          },
          inputs: (at) => inputs(env, raw, at),
          has: raw.has,
          draw: (svg, width, height) => pictured(env, svg, width, height),
          put: raw.put,
          record: (drawn) =>
            attempt?.retry ? attempt.retry(record(drawn)) : record(drawn)(),
          list: raw.list,
          delete: raw.delete,
        }).catch(
          // A run has no caller whose input could be refused, so a refusal
          // here is a failure too, and filed like one.
          (e) => {
            defect(e, { request: 'app splash', app: entity.eid })
            throw e
          },
        ).finally(() => pending.delete(entity.eid))
      await sharing(pending, entity.eid, work)
    },
  }
}
