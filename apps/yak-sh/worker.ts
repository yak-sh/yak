// yak.sh's server source: it answers the pages an agent or a crawler reads
// (docs.ts), with a canonical link on one that another page stands for, and
// every other request with a 404, which yaks.app answers with the app's files.
// The pages link each other at the address the visitor asked for: on a custom
// domain such as yak.sh that is `x-yak-address`, since the request itself
// names the app's address under its space.
import { pages, reading } from './docs.ts'

export default {
  fetch: (req: Request) => {
    let url = new URL(req.headers.get('x-yak-address') ?? req.url)
    let name = url.pathname.split('/').pop()!
    let docs = pages(new URL('.', url).href)
    if (!Object.hasOwn(docs, name)) {
      return new Response('not found', { status: 404 })
    }
    let doc = docs[name]
    let browser = !url.searchParams.has('raw') &&
      req.headers.get('sec-fetch-mode') == 'navigate' &&
      req.headers.get('accept')?.includes('text/html')
    let headers = new Headers({
      'content-type': `${browser ? 'text/html' : doc.type}; charset=utf-8`,
      'cache-control': 'no-store',
      vary: 'Accept, Sec-Fetch-Mode',
    })
    if (doc.canonical) {
      headers.set('link', `<${doc.canonical}>; rel="canonical"`)
    }
    return new Response(browser ? reading(name, doc) : doc.text, { headers })
  },
}
