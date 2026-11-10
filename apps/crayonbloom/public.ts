// Public pages and curated source artwork are independent of private books.
// The manifest names the only artwork and printable files this door serves;
// what a page says is kept in public/ and pages/, and drawn in the frame.
import routes from './public-routes.json' with { type: 'json' }
import assets from './public-assets.json' with { type: 'json' }
import { placed } from './pages/frame.ts'
import { prose } from './pages/prose.ts'
import { coloring, paths } from './pages/themes.ts'

type Files = { fetch(path: string): Promise<Response> }
let escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
let pictures = new Map<string, string>(
  assets.flatMap((asset): [string, string][] => [
    ['/' + asset.key, asset.key],
    [
      `/coloring-pages/${asset.theme}/printables/${asset.page}.pdf`,
      `public-printables/${asset.theme}/${asset.page}.pdf`,
    ],
  ]),
)
let types: Record<string, string> = {
  rss: 'application/rss+xml',
  xml: 'application/xml',
  txt: 'text/plain',
}
export let publicPage = async (
  request: Request,
  env: { FILES: Files },
): Promise<Response | null> => {
  if (!['GET', 'HEAD'].includes(request.method)) return null
  let url = new URL(request.headers.get('x-yak-address') ?? request.url)
  // A doubled slash (`//contact`) names the same page; left in, the base below
  // would start with `//` and parse as an address with no host.
  let path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '')
    .replace(/\.html$/, '')
  let headed = (response: Response) =>
    request.method == 'HEAD'
      ? new Response(null, {
        status: response.status,
        headers: response.headers,
      })
      : response
  let image = [...pictures.keys()].find((key) => path.endsWith(key))
  if (image) return headed(await env.FILES.fetch('/' + pictures.get(image)))
  // The longest app path the address ends in is the page; what is before it
  // is where the app is mounted.
  let route =
    [...paths, ...Object.keys(routes)].filter((key) => path.endsWith(key)).sort(
      (a, b) => b.length - a.length,
    )[0]
  if (!route) return null
  let place = placed(url.href, route)
  let drawn = coloring(place)
  if (drawn) return headed(drawn)
  let response = await env.FILES.fetch(
    '/public/' + routes[route as keyof typeof routes],
  )
  if (!response.ok) return response
  let kind = types[route.split('.').at(-1)!]
  if (!kind) return headed(prose(place, await response.text()))
  let base = url.origin + path.slice(0, -route.length) + '/'
  let text = (await response.text()).replaceAll(
    'href="/',
    `href="${escape(base)}`,
  )
    .replaceAll('src="/', `src="${escape(base)}`)
    .replaceAll('__APP_BASE__', escape(base))
  return new Response(request.method == 'HEAD' ? null : text, {
    headers: { 'content-type': kind + '; charset=utf-8' },
  })
}
