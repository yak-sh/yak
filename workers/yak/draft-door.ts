// A worker's customer keeps drafts without opening the app's private graph.
import { draftGateway, DraftRefused } from '@yaks/draft'
import type { Answer } from './apps.ts'
import { appStore } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { vouched } from './session.ts'

export let draftDoor: Answer = async (at) => {
  if (at.path != '/drafts') return null
  let { req, who, app, space, env } = at
  if (req.method != 'GET' && req.method != 'POST') {
    return at.json(405, 'method_not_allowed')
  }
  if (who.person == app.eid) {
    return at.json(403, 'customer', 'Keep drafts as the person using this app')
  }
  // Only the scoped gateway chooses rows and mutations. Its writes keep the
  // caller's provenance; a guest instrument never becomes a person or actor.
  let graph = metaOf(appStore(env.STORE, space, app, env), {
    ...KERNEL,
    ...vouched({ ...who, role: 'editor' }),
    'x-yak-administrative': '1',
  })
  try {
    let gateway = draftGateway({
      query: (line) => graph.query(line),
      apply: async (rows) => ({ bundles: await graph.apply(rows) }),
    }, who)
    let value
    if (req.method == 'GET') value = await gateway.snapshot()
    else {
      let sent: unknown
      try {
        sent = await req.json()
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        return at.json(400, 'arguments', 'Send a saved draft as a JSON object')
      }
      if (!sent || typeof sent != 'object' || Array.isArray(sent)) {
        return at.json(400, 'arguments', 'Send a saved draft as a JSON object')
      }
      value = await gateway.write(sent as Record<string, unknown>)
    }
    return Response.json(value, {
      headers: { 'cache-control': 'private, no-store' },
    })
  } catch (error) {
    if (!(error instanceof DraftRefused)) throw error
    return at.json(409, 'draft', error.message)
  }
}
