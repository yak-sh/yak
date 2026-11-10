// Public pages and curated source artwork are independent of private books.
// The manifest names the only artwork and printable files this door serves.
import routes from './public-routes.json' with { type: 'json' }
import assets from './public-assets.json' with { type: 'json' }

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
  css: 'text/css',
  rss: 'application/rss+xml',
  xml: 'application/xml',
  txt: 'text/plain',
  md: 'text/markdown',
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
  let image = [...pictures.keys()].find((key) => path.endsWith(key))
  if (image) {
    let response = await env.FILES.fetch('/' + pictures.get(image))
    return request.method == 'HEAD'
      ? new Response(null, {
        status: response.status,
        headers: response.headers,
      })
      : response
  }
  let route = Object.keys(routes).find((key) => path.endsWith(key))
  if (!route) return null
  let response = await env.FILES.fetch(
    '/public/' + routes[route as keyof typeof routes],
  )
  if (!response.ok) return response
  let base = url.origin + path.slice(0, -route.length) + '/'
  let text = (await response.text()).replaceAll(
    'href="/',
    `href="${escape(base)}`,
  )
    .replaceAll('src="/', `src="${escape(base)}`)
    .replaceAll('__APP_BASE__', escape(base))
  return new Response(request.method == 'HEAD' ? null : text, {
    headers: {
      'content-type': (types[route.split('.').at(-1)!] ?? 'text/html') +
        '; charset=utf-8',
    },
  })
}
