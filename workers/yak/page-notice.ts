// A release or draft write reaches every page, whether it has subscribed yet
// or not. Storage and socket ownership belong to the caller.
import { json, readBody, refuse } from '@yaks/api'
import { Refused } from '@yaks/graph/errors'

/** Send one packet to every page, reporting a broken socket and continuing. */
export let broadcast = (
  pages: Iterable<{ send(packet: string): void }>,
  packet: string,
  failed: (error: unknown) => void,
) => {
  for (let page of pages) {
    try {
      page.send(packet)
    } catch (error) {
      failed(error)
    }
  }
}

/** The kernel's draft notice, sent to every page on its preview link. */
export let drafted = async (
  request: Request,
  send: (packet: string) => void,
) => {
  if (request.headers.get('x-yak-kernel') != '1' || request.method != 'POST') {
    return json({ error: 'NotFound', message: 'no route' }, 404)
  }
  let draft
  try {
    draft = (JSON.parse(await readBody(request)) as { draft?: unknown }).draft
    if (!draft || typeof draft != 'object' || Array.isArray(draft)) {
      throw new Refused('/drafted needs a draft')
    }
  } catch (error) {
    return refuse(error, request)
  }
  send(JSON.stringify({ draft }))
  return Response.json({ ok: true })
}
