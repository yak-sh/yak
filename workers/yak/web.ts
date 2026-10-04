// The app-scoped @yaks/web page. Assets are built from the package at deploy;
// this door only mounts that page onto the app's existing API and identity.
import type { Env } from './env.ts'
import type { Hosting } from '../../packages/browse/hosting.ts'

export let webPath = (path: string) =>
  path == '/_web' || path.startsWith('/_web/')
export let webHost = (at: string): Hosting => ({
  page: at + '/_web',
  api: at + '/api',
  apply: at + '/api/apply',
  owner: at + '/_web/owner',
})
export let webAsset = async (req: Request, env: Env, name: string) => {
  let response = await env.ASSETS.fetch(
    new Request(new URL('/_web/' + name, req.url), req),
  )
  if (name != 'manifest.webmanifest' || !response.ok) return response
  let value = await response.json() as {
    id: string
    scope: string
    start_url: string
    icons: { src: string }[]
  }
  let root = new URL(req.url).pathname.split('/_web/')[0] + '/_web/'
  return Response.json({
    ...value,
    id: root,
    scope: root,
    start_url: root,
    icons: value.icons.map((icon) => ({
      ...icon,
      src: root + icon.src.slice(1),
    })),
  }, {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': 'no-store',
    },
  })
}

export let webPage = async (
  req: Request,
  env: Env,
  at: string,
  person: string,
) => {
  let path = new URL(req.url).pathname
  if (path == at + '/_web/owner') {
    return Response.json({ owner: person }, {
      headers: { 'cache-control': 'no-store' },
    })
  }
  let asset = await env.ASSETS.fetch(
    new Request(new URL('/_web/index.html', req.url), req),
  )
  if (!asset.ok) return asset
  let host = { ...webHost(at), storage: `${at}:${person}` }
  let page = (await asset.text()).replaceAll('/web/', host.page + '/web/')
  // Keep a cached browser page from mixing one deploy's JS with another.
  let version = encodeURIComponent(env.CF_VERSION_METADATA?.id ?? '')
  let assets = '/web/'
  page = page.replaceAll(assets + 'app.js"', `${assets}app.js?v=${version}"`)
    .replaceAll(assets + 'styles.css"', `${assets}styles.css?v=${version}"`)
  page = page.replace(
    'rel="manifest"',
    'rel="manifest" crossorigin="use-credentials"',
  )
  // JSON lives as data, never executable text supplied by an app or person.
  let data = JSON.stringify(
    host,
  ).replaceAll('<', '\\u003c')
  page = page.replace(
    '<head>',
    `<head><script>globalThis.YAK_WEB=${data}</script>`,
  )
  return new Response(req.method == 'HEAD' ? null : page, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
