// The app-scoped @yaks/web page. Assets are built from the package at deploy;
// this door only mounts that page onto the app's existing API and identity.
import type { Env } from './env.ts'
import type { Hosting } from '../../packages/web/hosting.ts'

export let webPath = (path: string) =>
  path == '/_web' || path.startsWith('/_web/')
export let webHost = (at: string): Hosting => ({
  page: at + '/_web',
  api: at + '/api',
  apply: at + '/api/apply',
  owner: at + '/_web/owner',
})
export let webAsset = (req: Request, env: Env, name: string) =>
  env.ASSETS.fetch(new Request(new URL('/_web/' + name, req.url), req))

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
    new Request(new URL('/_web/index.html', req.url)),
  )
  if (!asset.ok) return asset
  let host = { ...webHost(at), storage: `${at}:${person}` }
  let page = (await asset.text()).replaceAll('/web/', host.page + '/web/')
  // JSON lives as data, never executable text supplied by an app or person.
  let data = JSON.stringify(host).replaceAll('<', '\\u003c')
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
