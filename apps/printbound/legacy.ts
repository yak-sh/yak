// Existing order capabilities resolve to their imported historical receipt.
// This door has no payment, rendering, fulfillment, membership or mail effects.
import { type Bundle, sha256 } from '@yaks/graph'
import { h } from 'preact'
import { Button } from '@yaks/ui/parts'
import { appBase } from './request.ts'
import { note } from './site/note.ts'

export type Historical = {
  id: string
  seller: string
  status: string
  historical: true
  tracking?: string
  checkout?: string
  payment?: Record<string, unknown>
  provider?: Record<string, unknown>
}
export type LegacyStore = {
  query: (q: string) => Promise<Bundle[]>
  apply?: (rows: Bundle[]) => Promise<unknown>
}
type LegacyBook = Bundle & {
  doc?: { title: string }
  book_receipt?: { receipt: Historical }
  legacy_order?: { binding: string }
}
let records = async (db: LegacyStore, q: string): Promise<LegacyBook[]> =>
  await db.query(q) as LegacyBook[]
export let capability = (order: string, token: string): string =>
  sha256(JSON.stringify([order, token]))

let json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store, private' },
  })

let optOut = (request: Request, unsubscribed: boolean): Response => {
  if (request.headers.get('accept')?.includes('application/json')) {
    return json({ unsubscribed })
  }
  let page = note(
    appBase(request).href,
    'Unsubscribe',
    unsubscribed
      ? h('p', {}, 'You are unsubscribed from commercial messages.')
      : [
        h('p', {}, 'You can stop commercial messages from PrintBound.'),
        h('form', { method: 'post' }, h(Button, { mod: 'go' }, 'Unsubscribe')),
      ],
  )
  return new Response(page, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private',
    },
  })
}

/** A token proves access to one order, never to its owner's other records. */
export let legacyStatus = async (
  db: LegacyStore,
  value: Record<string, unknown>,
): Promise<Record<string, unknown> | null> => {
  if (
    typeof value.order_id !== 'string' || typeof value.access_token !== 'string'
  ) return null
  if (!value.order_id || !value.access_token) return null
  let digest = capability(value.order_id, value.access_token)
  let [row] = await records(
    db,
    `.legacy_order.digest=${digest}&?doc&?book_receipt`,
  )
  let receipt = row?.book_receipt?.receipt as Historical | undefined
  if (!receipt?.historical || receipt.id !== value.order_id) return null
  let status = receipt.status === 'quarantined'
    ? 'awaiting_review'
    : receipt.status
  return {
    order_id: receipt.id,
    status,
    status_label: status.replaceAll('_', ' '),
    lulu_status: receipt.provider?.status ?? null,
    tracking_url: receipt.tracking ?? null,
    title: row.doc?.title ?? '',
    binding: row.legacy_order?.binding ?? '',
    message: receipt.tracking
      ? `Track your book: ${receipt.tracking}`
      : 'This is the last recorded status of your order.',
  }
}

let tool = {
  name: 'get_order_status',
  description:
    'Check the recorded status of an existing PrintBound order using its order capability.',
  inputSchema: {
    type: 'object',
    properties: {
      order_id: { type: 'string' },
      access_token: { type: 'string' },
    },
    required: ['order_id', 'access_token'],
  },
}
let migrated = [
  'get_print_quote',
  'collect_shipping_address',
  'create_checkout',
  'storybook_guide',
]
let migrationTools = migrated.map((name) => ({
  name,
  description:
    'Continue an existing PrintBound client into the reviewed-document storefront before pricing or checkout.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: true },
}))

/** The app wrapper supplies its trusted store; responses contain receipt fields only. */
export let legacyPage = async (
  request: Request,
  db: LegacyStore,
): Promise<Response | null> => {
  let url = new URL(request.url), path = url.pathname
  let unsubscribe = path.match(/^\/unsubscribe(?:\/([^/]+))?$/)
  if (unsubscribe && ['GET', 'POST'].includes(request.method)) {
    // The source mailed `/unsubscribe?token=…`, which suppressed on opening
    // and answers RFC 8058's one-click POST; the path form asks first.
    let token = url.searchParams.get('token') ?? ''
    let opens = !unsubscribe[1]
    try {
      if (unsubscribe[1]) token = decodeURIComponent(unsubscribe[1])
    } catch {
      return json({ error: 'This link is not available.' }, 404)
    }
    let [row] = token
      ? await db.query(
        `.legacy_opt_out.digest=${sha256(token)}&?mail_opt_out`,
      )
      : []
    if (!row) return json({ error: 'This link is not available.' }, 404)
    let suppress = opens || request.method === 'POST'
    if (suppress && !row.mail_opt_out) {
      if (!db.apply) {
        throw Error('The unsubscribe write boundary is unavailable')
      }
      await db.apply([{
        entity: row.entity,
        mail_opt_out: { at: new Date().toISOString() },
      }])
    }
    return optOut(request, suppress || !!row.mail_opt_out)
  }
  if (!['/mcp', '/legacy/order_status'].includes(path)) return null
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  let value: Record<string, unknown>
  try {
    value = await request.json()
  } catch {
    return json({ error: 'Send a JSON object.' }, 400)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return json({ error: 'Send a JSON object.' }, 400)
  }
  if (path === '/legacy/order_status') {
    let status = await legacyStatus(db, value)
    return status ? json(status) : json(
      { error: 'No order found for that order_id and access_token.' },
      404,
    )
  }
  let reply = (result: unknown) =>
    json({ jsonrpc: '2.0', id: value.id ?? null, result })
  if (value.method === 'notifications/initialized') {
    return new Response(null, { status: 202 })
  }
  if (value.method === 'initialize') {
    return reply({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'printbound-orders', version: '1' },
    })
  }
  if (value.method === 'tools/list') {
    return reply({ tools: [tool, ...migrationTools] })
  }
  let params = value.params as {
    name?: string
    arguments?: Record<string, unknown>
  } | undefined
  if (
    value.method === 'tools/call' && params?.name &&
    migrated.includes(params.name)
  ) {
    let address =
      new URL('.', request.headers.get('x-yak-address') ?? request.url).href
    let message =
      `Open ${address} to sign in, prepare your book and review its exact print files before requesting a quote or checkout. Existing order_id/access_token pairs continue to work with get_order_status.`
    return reply({
      isError: true,
      structuredContent: { next: 'prepare', sign_in_url: address },
      content: [{ type: 'text', text: message }],
    })
  }
  if (value.method !== 'tools/call' || params?.name !== 'get_order_status') {
    return json({
      jsonrpc: '2.0',
      id: value.id ?? null,
      error: { code: -32601, message: 'Unknown method or tool.' },
    })
  }
  let status = await legacyStatus(db, params.arguments ?? {})
  return reply(
    status
      ? {
        structuredContent: status,
        content: [{ type: 'text', text: JSON.stringify(status) }],
      }
      : {
        isError: true,
        content: [{
          type: 'text',
          text: 'No order found for that order_id and access_token.',
        }],
      },
  )
}
