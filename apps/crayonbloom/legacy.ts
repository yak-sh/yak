// Existing printable, receipt and unsubscribe URLs keep their scoped reach.
// The wrapper verifies legacy signed sessions/cookies at its authentication
// boundary and passes only the resolved principal; source secrets stay there.
import { type Bundle, sha256 } from '@yaks/graph'

export type LegacyPrincipal = { owner?: string; via?: string }
export type LegacyStore = {
  query: (q: string) => Promise<Bundle[]>
  apply: (rows: Bundle[]) => Promise<unknown>
}
type LegacyRow = Bundle & {
  legacy_record?: { snapshot: Record<string, unknown> }
  legacy_asset?: { role: string }
  print_receipt?: { receipt: Record<string, unknown> }
}
let records = async (db: LegacyStore, q: string): Promise<LegacyRow[]> =>
  await db.query(q) as LegacyRow[]
let json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store, private' },
  })
let missing = () => json({ error: 'This link is not available.' }, 404)
let optOut = (request: Request, unsubscribed: boolean): Response => {
  if (request.headers.get('accept')?.includes('application/json')) {
    return json({ unsubscribed })
  }
  let body = unsubscribed
    ? '<p>You are unsubscribed from commercial messages.</p>'
    : '<p>You can stop commercial messages from CrayonBloom.</p><form method="post"><button>Unsubscribe</button></form>'
  return new Response(
    `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><main><h1>Unsubscribe</h1>${body}</main></html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private',
      },
    },
  )
}
let decoded = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
let valid = (value?: string): boolean =>
  !!value && /^[a-f0-9-]{36}$/i.test(value)
let principal = (who: LegacyPrincipal): string[] => [
  ...(valid(who.owner) ? [`.legacy_record.owner=${who.owner}`] : []),
  ...(valid(who.via)
    ? [`.legacy_record.via=${who.via}&!.legacy_record.owner`]
    : []),
]

/** This reads only source history; it cannot submit, charge or regenerate. */
export let legacyPage = async (
  request: Request,
  db: LegacyStore,
  who: LegacyPrincipal,
  now = new Date().toISOString(),
): Promise<Response | null> => {
  let path = new URL(request.url).pathname
  let page = path.match(/^\/free_pages\/([^/]+)$/)
  if (page && request.method === 'GET') {
    let token = decoded(page[1])
    if (!token) return missing()
    let [row] = await records(
      db,
      `.legacy_page.digest=${sha256(token)}&?legacy_record`,
    )
    if (!row) return missing()
    let assets = await records(db, `.legacy_asset.record=${row.entity.eid}`)
    return json({
      prompt: row.legacy_record?.snapshot.prompt,
      status: row.legacy_record?.snapshot.status,
      artwork: assets.filter((r) => r.legacy_asset?.role === 'artwork').map((
        r,
      ) => r.legacy_asset),
    })
  }
  let order = path.match(/^\/orders\/(\d+)$/)
  if (order && request.method === 'GET') {
    let access = principal(who)
    if (!access.length) return missing()
    let rows = (await Promise.all(access.map((filter) =>
      records(db, `.legacy_record.table=orders&${filter}&?print_receipt`)
    ))).flat()
    let row = rows.find((r) =>
      String(r.legacy_record?.snapshot.id) === order[1]
    )
    let receipt = row?.print_receipt?.receipt
    if (!receipt?.historical) {
      return missing()
    }
    return json({
      id: receipt.id,
      title: receipt.title,
      status: receipt.status,
      tracking: receipt.tracking ?? null,
    })
  }
  let unsubscribe = path.match(/^\/unsubscribe\/([^/]+)$/)
  if (unsubscribe && ['GET', 'POST'].includes(request.method)) {
    let token = decoded(unsubscribe[1])
    if (!token) return missing()
    let [row] = await db.query(
      `.legacy_opt_out.digest=${sha256(token)}&?mail_opt_out`,
    )
    if (!row) return missing()
    if (request.method === 'POST' && !row.mail_opt_out) {
      await db.apply([{ entity: row.entity, mail_opt_out: { at: now } }])
    }
    return optOut(request, request.method === 'POST' || !!row.mail_opt_out)
  }
  return null
}
