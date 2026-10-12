// Authenticated tracker RPC is narrow: readers never get a general graph
// writer. Intake and bug marks each need their own signed capability.

import type { TrackerStore } from './core.ts'
import { authorize } from './auth.ts'
import { api } from '@yaks/api'
import { CallError } from '@yaks/tools'
import { minted, status } from '@yaks/graph'
import type { Bundle } from '@yaks/graph'
import { platform } from './core.ts'
import { batch } from './queue.ts'

let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export let json = (value: unknown, status = 200) =>
  Response.json(value, { status })
export let door = (
  tracker: TrackerStore,
  scope: string,
  secret: string | undefined,
  websocket?: (request: Request) => Response,
  ingest: (rows: Bundle[]) => Promise<void> = tracker.ingest,
) =>
async (request: Request): Promise<Response> => {
  let access = await authorize(request, secret, scope)
  if (!access) return json({ error: 'tracker scope denied' }, 403)
  let url = new URL(request.url)
  let path = url.pathname
  if (request.method == 'POST' && path == '/errors') {
    if (scope != platform || !access.admin || access.ingest !== true) {
      return json({ error: 'tracker intake denied' }, 403)
    }
    let rows: Bundle[]
    try {
      let capture = batch(await request.json())
      let names = [
        'entity',
        '$actor',
        'error',
        'exception',
        'during',
        'breadcrumbs',
        'request',
      ]
      if (
        capture.scope != platform ||
        capture.rows.some((row) =>
          Object.keys(row).some((key) => !names.includes(key))
        )
      ) throw Error()
      rows = capture.rows
    } catch {
      return json(
        { error: 'tracker intake expects platform error captures' },
        400,
      )
    }
    await ingest(rows)
    return json({ ok: true })
  }
  if (request.method == 'POST' && path == '/app-errors') {
    // Only yak's vouched compatibility adapter can mark occurrences. Reader
    // tickets remain unable to write, and no arbitrary component is accepted.
    if (!access.admin || access.ingest !== true) {
      return json({ error: 'tracker marks denied' }, 403)
    }
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid app error mark' }, 400)
    }
    if (
      !body || typeof body != 'object' || Array.isArray(body) ||
      typeof body.app != 'string' ||
      !minted(body.app) || !Array.isArray(body.eids) ||
      body.eids.length > 100 ||
      body.eids.some((eid: unknown) =>
        typeof eid != 'string' || !minted(eid)
      ) ||
      !['notified', 'archived'].includes(body.mark)
    ) {
      return json({
        error:
          'app, up to 100 occurrence eids and a delivery/archive mark required',
      }, 400)
    }
    return json({
      marked: await tracker.markErrors(body.app, body.eids, body.mark),
    })
  }
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
  if (request.method == 'GET' && path == '/bugs') {
    let params = url.searchParams
    if (params.get('app') == '') params.delete('app')
    let n = Number(params.get('limit') ?? 50)
    if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
      return json({ error: 'limit must be 1..100' }, 400)
    }
    for (let key of ['app', 'bug']) {
      if (params.has(key) && !minted(params.get(key)!)) {
        return json({ error: `${key} must be a global eid` }, 400)
      }
    }
    try {
      return json(
        params.has('bug')
          ? await tracker.bug(params.get('bug')!)
          : await tracker.bugs(
            params.get('app') ?? undefined,
            params.get('query') ?? '.bug',
            n,
          ),
      )
    } catch (error) {
      if (error instanceof CallError && error.code == 'bug') {
        return json({ error: 'bug not found' }, 404)
      }
      if (status(error) < 500) return json({ error: String(error) }, 400)
      throw error
    }
  }
  if (path == '/unseen') {
    return json(await tracker.unseen(url.searchParams.get('app') ?? undefined))
  }
  if (request.method == 'POST' && (path == '/resolve' || path == '/archive')) {
    if (access.mark !== true) {
      return json({ error: 'tracker bug marks denied' }, 403)
    }
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'bug global eid required' }, 400)
    }
    if (
      !body || typeof body != 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => key != 'bug') ||
      typeof body.bug != 'string' || !minted(body.bug)
    ) {
      return json({ error: 'bug global eid required' }, 400)
    }
    try {
      await tracker.mark(body.bug, path == '/resolve' ? 'resolved' : 'archived')
    } catch (error) {
      if (error instanceof CallError && error.code == 'bug') {
        return json({ error: 'bug not found' }, 404)
      }
      throw error
    }
    return json({ ok: true })
  }
  if (request.method == 'POST' && path == '/deployed') {
    if (access.mark !== true) {
      return json({ error: 'tracker bug marks denied' }, 403)
    }
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
