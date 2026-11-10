// Public reading routes use only the declared static files, under the address
// where this app is opened; its private source and saved books never enter it.
import routes from './public-routes.json' with { type: 'json' }

type Files = { fetch(path: string): Promise<Response> }
let escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
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
  // A doubled slash (`//terms`) names the same page; left in, the base below
  // would start with `//` and parse as an address with no host.
  let path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '')
    .replace(/\.html$/, '')
  let route = Object.keys(routes).find((key) => path.endsWith(key))
  if (!route) return null
  let file = routes[route as keyof typeof routes]
  let response = await env.FILES.fetch('/public/' + file)
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
