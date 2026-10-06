// Authenticated tracker RPC is narrow: readers never get a general graph
// writer or trusted intake. Each HTTP request is bound to one global scope.

import type { TrackerStore } from './core.ts'
import { authorize } from './auth.ts'
import { api } from '@yaks/api'

export let json = (value: unknown, status = 200) =>
  Response.json(value, { status })
export let door = (
  tracker: TrackerStore,
  scope: string,
  secret: string | undefined,
  websocket?: (request: Request) => Response,
) =>
async (request: Request): Promise<Response> => {
  let access = await authorize(request, secret, scope)
  if (!access) return json({ error: 'tracker scope denied' }, 403)
  let url = new URL(request.url)
  let path = url.pathname
  if (path == '/ws') {
    return websocket?.(request) ?? json({ error: 'websocket unavailable' }, 503)
  }
  if (path == '/query' || path == '/vocab') {
    return await api({ graph: tracker.graph })(request)
  }
  if (request.method == 'GET' && (path == '/traces' || path == '/trace')) {
    let count = url.searchParams.get('limit')
    let n = count == null ? (path == '/traces' ? 50 : 100) : Number(count)
    let cursor = url.searchParams.get('after') ?? undefined
    let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (
      !Number.isSafeInteger(n) || n < 1 || n > 100 ||
      (cursor != null && !uuid.test(cursor))
    ) {
      return json({ error: 'limit must be 1..100 and after a global eid' }, 400)
    }
    if (path == '/traces') {
      let app = url.searchParams.get('app') ?? undefined
      if (app != null && !uuid.test(app)) {
        return json({ error: 'app must be a global eid' }, 400)
      }
      return json(await tracker.traces(app, n, cursor))
    }
    let eid = url.searchParams.get('eid')
    if (!eid || !uuid.test(eid)) {
      return json({ error: 'trace global eid required' }, 400)
    }
    let found = await tracker.trace(eid, n, cursor)
    return found ? json(found) : json({ error: 'trace not found' }, 404)
  }
  if (path == '/bugs') {
    return json(await tracker.bugs(url.searchParams.get('app') ?? undefined))
  }
  if (path == '/unseen') {
    return json(await tracker.unseen(url.searchParams.get('app') ?? undefined))
  }
  if (request.method == 'POST' && (path == '/resolve' || path == '/archive')) {
    let body = await request.json()
    if (typeof body.bug != 'string') {
      return json({ error: 'bug eid required' }, 400)
    }
    await tracker.mark(body.bug, path == '/resolve' ? 'resolved' : 'archived')
    return json({ ok: true })
  }
  if (request.method == 'POST' && path == '/deployed') {
    let body = await request.json()
    if (typeof body.app != 'string') {
      return json({ error: 'app eid required' }, 400)
    }
    await tracker.deployed(
      body.app,
      typeof body.version == 'number' ? body.version : undefined,
    )
    return json({ ok: true })
  }
  return json({ error: 'tracker route not found' }, 404)
}
