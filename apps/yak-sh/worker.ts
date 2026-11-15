// yak.sh's server source: it answers the pages an agent or a crawler reads
// (docs.ts), with a canonical link on one that another page stands for, and
// every other request with a 404, which yaks.app answers with the app's files.
// The pages link each other at the address the visitor asked for: on a custom
// domain such as yak.sh that is `x-yak-address`, since the request itself
// names the app's address under its space.
import { pages } from './docs.ts'

export default {
  fetch: (req: Request) => {
    let url = new URL(req.headers.get('x-yak-address') ?? req.url)
    let doc = pages(new URL('.', url).href)[url.pathname.split('/').pop()!]
    if (!doc) return new Response('not found', { status: 404 })
    let headers = new Headers({ 'content-type': `${doc.type}; charset=utf-8` })
    if (doc.canonical) {
      headers.set('link', `<${doc.canonical}>; rel="canonical"`)
    }
    return new Response(doc.text, { headers })
  },
}
