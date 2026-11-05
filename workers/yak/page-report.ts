// What breaks in the platform's own pages: the reporter (public/report.js),
// named first in every page's head (sheets.ts `links`), posts here, at the
// apex's `/api/report`, and each break enters the tracker as a platform
// defect tagged with the page it happened on. An app's page reports to its
// own door instead (apps.ts), where the break is the app's.
import { broken } from '@yaks/tracker/report'
import { defect } from './defects.ts'
import { isVerifiedBot } from './lib/bots.ts'
import { refusal } from './unseen.ts'

export let PATH = '/api/report'

/** File what a platform page says broke. A no one of our doors meant is no
 * break (unseen.ts `refusal`), and a page a verified bot renders has nobody
 * looking at it. */
export let answer = async (req: Request): Promise<Response> => {
  if (req.method != 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }
  if (isVerifiedBot(req)) {
    await req.body?.cancel()
    return new Response(null, { status: 204 })
  }
  for (
    let { request, message, stack, mechanism, breadcrumbs } of broken(
      await req.text(),
      refusal,
    )
  ) {
    defect(Object.assign(Error(message), { stack }), {
      request,
      page: request.slice(request.indexOf(' ') + 1),
    }, { page: { mechanism, breadcrumbs } })
  }
  return new Response(null, { status: 204 })
}
