// Existing printable, receipt and unsubscribe URLs keep their scoped reach.
// The wrapper verifies legacy signed sessions/cookies at its authentication
// boundary and passes only the resolved principal; source secrets stay there.
import { type Bundle, sha256 } from '@yaks/graph'
import type { Rails } from './rails.ts'

export type LegacyPrincipal = { owner?: string; via?: string }
export type LegacyStore = {
  query: (q: string) => Promise<Bundle[]>
  apply: (rows: Bundle[]) => Promise<unknown>
}
type LegacyRow = Bundle & {
  legacy_record?: { snapshot: Record<string, unknown> }
  legacy_asset?: {
    role: string
    blob: string
    mime: string
    source_blob?: string
  }
  print_receipt?: { receipt: Record<string, unknown> }
}
export type LegacyPorts = {
  credentials?: Rails
  asset?: (blob: string) => Promise<Response>
  bind?: (
    claim: { kind: 'user' | 'guest'; id: string },
    caller: LegacyPrincipal,
  ) => Promise<LegacyPrincipal>
}

/** A source signature and a vouched platform principal are both required by
 * the binding boundary. A client-supplied email never participates. */
export let legacyIdentity = async (
  request: Request,
  caller: LegacyPrincipal,
  ports: LegacyPorts,
  now: string,
): Promise<LegacyPrincipal> => {
  if (!ports.credentials || !ports.bind) return caller
  let claims = await ports.credentials.identity(request, now)
  if ((!caller.owner && !caller.via) || (!claims.user && !claims.guest)) {
    return caller
  }
  return ports.bind(
    claims.user
      ? { kind: 'user', id: claims.user }
      : { kind: 'guest', id: claims.guest! },
    caller,
  )
}
let records = async (db: LegacyStore, q: string): Promise<LegacyRow[]> =>
  await db.query(q) as LegacyRow[]
let artifact = async (ports: LegacyPorts, blob: string): Promise<Response> => {
  if (!ports.asset) {
    throw Error('The legacy asset read boundary is unavailable')
  }
  let response = await ports.asset(blob)
  if (!response.ok) {
    throw Error(`Imported asset read failed (${response.status})`)
  }
  let headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store, private')
  return new Response(response.body, { status: response.status, headers })
}
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
    ? [`.legacy_record.via=${who.via}&!legacy_record.owner`]
    : []),
]

/** This reads only source history; it cannot submit, charge or regenerate. */
export let legacyPage = async (
  request: Request,
  db: LegacyStore,
  who: LegacyPrincipal,
  now = new Date().toISOString(),
  ports: LegacyPorts = {},
): Promise<Response | null> => {
  let path = new URL(request.url).pathname
  let blob = path.match(
    /^\/rails\/active_storage\/blobs\/(?:redirect|proxy)\/([^/]+)\/[^/]+$/,
  )
  if (blob && request.method === 'GET') {
    let value = decoded(blob[1])
    let id = value && ports.credentials
      ? await ports.credentials.blob(value, now)
      : undefined
    if (!id) return missing()
    let [asset] = await records(db, `.legacy_asset.source_blob=${id}`)
    if (!asset?.legacy_asset) return missing()
    return artifact(ports, asset.legacy_asset.blob)
  }
  let page = path.match(/^\/free_pages\/([^/]+)(\/artwork)?$/)
  if (page && request.method === 'GET') {
    let token = decoded(page[1])
    if (!token) return missing()
    let [row] = await records(
      db,
      `.legacy_page.digest=${sha256(token)}&?legacy_record`,
    )
    if (!row) return missing()
    let assets = await records(db, `.legacy_asset.record=${row.entity.eid}`)
    if (page[2]) {
      let asset = assets.find((r) => r.legacy_asset?.role === 'artwork')
        ?.legacy_asset
      if (!asset) return missing()
      return artifact(ports, asset.blob)
    }
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
