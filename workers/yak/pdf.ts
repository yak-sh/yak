import type { Asked } from './apps.ts'
import type { Env } from './env.ts'
import { writes } from '@yaks/member'

type PageRequest = Pick<Asked, 'req' | 'path' | 'who' | 'refuse' | 'json'> & {
  env: Pick<Env, 'RASTER'>
}

/** PDF page rendering is a generic platform capability. The app's server
 * calls through env.APP; page clients need the app's write permission. */
export let pdfDoor = (
  { req, path, env, who, refuse, json }: PageRequest,
) => {
  if (path != '/pdf') return null
  if (!writes(who.role)) return refuse('not_a_writer')
  if (req.method != 'POST') {
    return json(405, 'method', 'POST a PDF to render its page')
  }
  if (!env.RASTER) throw new Error('PDF page renderer is not bound')
  let url = new URL(req.url)
  let page = Number(url.searchParams.get('page'))
  if (!Number.isInteger(page) || page < 1) {
    return json(400, 'page', 'Choose a 1-based PDF page')
  }
  return env.RASTER.fetch(
    new Request('https://raster/pdf' + url.search, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: req.body,
    }),
  )
}
