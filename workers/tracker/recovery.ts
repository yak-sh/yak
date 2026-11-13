import type { Ceiling } from '@yaks/durable-object'
import type { Access } from './auth.ts'
import { json } from './door.ts'

/** Administrative recovery stays reachable while the graph cannot boot. */
export let recovery = async (
  request: Request,
  access: Access,
  ceiling: Ceiling,
  keep: (key: string, value: unknown) => Promise<void>,
): Promise<Response | undefined> => {
  let path = new URL(request.url).pathname
  if (path != '/ceiling' && path != '/resume') return
  if (!access.admin) return json({ error: 'admin required' }, 403)
  if (path == '/ceiling' && request.method == 'GET') {
    return json({ spent: ceiling.spent(), wait: ceiling.stopped() })
  }
  if (path != '/resume' || request.method != 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }
  if (!access.mark) return json({ error: 'mark capability required' }, 403)
  let body = await request.json().catch(() => null)
  let reason = body?.reason
  if (typeof reason != 'string' || !reason.trim()) {
    return json({ error: 'recovery reason required' }, 400)
  }
  let record = {
    eid: crypto.randomUUID(),
    at: new Date().toISOString(),
    person: access.person,
    reason,
    spent: ceiling.spent(),
  }
  await keep(`ceiling:resumed:${record.eid}`, record)
  ceiling.resume()
  console.log('tracker resumed', JSON.stringify(record))
  // A window an earlier resume opened still stands: its wait says so.
  return json({ ...record, wait: ceiling.stopped() })
}
