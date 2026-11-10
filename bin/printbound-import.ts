// PrintBound's D1 export contract, read from bindery migrations 0001–0038.
// Capability and payment fields remain in data; projections must not log them.
import type { Catalog, Inventory, Owner, Tables } from './venture-import.ts'
import { inventory } from './venture-import.ts'
import type { Imported } from './venture-import.ts'
import { capability, type Historical } from '../apps/printbound/legacy.ts'
import type { Bundle } from '@yaks/graph'
import { sha256 } from '@yaks/graph'

export let printboundTables: Catalog = {
  quotes: { key: ['quote_id'] },
  orders: {
    key: ['order_id'],
    refs: {
      quote_id: { table: 'quotes' },
      source_order_id: { table: 'orders', optional: true },
    },
  },
  addresses: { key: ['address_id'] },
  drafts: {
    optional: true,
    key: ['draft_id'],
    refs: { order_id: { table: 'orders', optional: true } },
  },
  fulfilment_jobs: {
    key: ['order_id'],
    refs: { order_id: { table: 'orders' } },
  },
  legal_hold_events: {
    key: ['event_id'],
    refs: { order_id: { table: 'orders' } },
  },
  ops_alert_outbox: {
    key: ['alert_id'],
    refs: { order_id: { table: 'orders', optional: true } },
  },
  consumed_link_tokens: { key: ['nonce'] },
  account_revocations: { key: ['email'] },
  account_link_sends: { key: ['email', 'window_start'] },
  reorder_attempts: { key: ['email', 'window_start'] },
  erasure_requests: { key: ['request_id'] },
  activations: { key: ['caller_hash'] },
  orderable: { key: ['id'] },
  stripe_delivery_verified: { key: ['id'], optional: true },
  free_draft_caps: { key: ['scope', 'caller', 'window_day'], optional: true },
  global_free_draw_budget: { key: ['window_day'], optional: true },
}

export let printboundWaitlist: Catalog = { signups: { key: ['id'] } }

export let printbound = (source: string, tables: Tables): Inventory =>
  inventory(source, tables, printboundTables)

export type Owners = (row: Imported) => Owner

let purchase = (row: Imported): Historical => {
  let order = row.data
  return {
    id: String(order.order_id),
    seller: 'PrintBound',
    historical: true,
    status: String(order.status),
    ...(order.tracking_url ? { tracking: String(order.tracking_url) } : {}),
    ...(order.stripe_session_id
      ? { checkout: String(order.stripe_session_id) }
      : {}),
    payment: {
      checkout: order.stripe_session_id ?? null,
      intent: order.stripe_payment_intent ?? null,
      event: order.stripe_event_id ?? null,
      status: order.stripe_payment_status ?? null,
      subtotal: order.stripe_amount_subtotal ?? null,
      tax: order.stripe_amount_tax ?? null,
      total: order.stripe_amount_total ?? null,
      currency: order.stripe_currency ?? null,
    },
    provider: {
      id: order.lulu_order_id ?? null,
      reference: order.lulu_order_ref ?? null,
    },
  }
}

/** Owner mappings come from verified identity continuity, never an email guess. */
export let printboundBook = (
  source: string,
  row: Imported,
  owners: Owners,
): Bundle | undefined => {
  if (!['orders', 'drafts'].includes(row.table)) return undefined
  let owner = owners(row)
  if (!owner.owner && !owner.via) {
    throw Error('An imported book requires verified ownership')
  }
  let data = row.data
  return {
    entity: { eid: row.eid },
    doc: { title: String(data.title ?? data.idea_prompt ?? '') },
    book_source: {
      ...owner,
      author: String(data.author ?? ''),
      markdown: String(data.content_markdown ?? ''),
      dedication: String(data.gift_message ?? ''),
    },
    book_legacy: { source, table: row.table, key: row.key, snapshot: data },
    ...(row.table === 'orders'
      ? {
        book_receipt: { receipt: purchase(row) },
        ...(data.access_token
          ? {
            legacy_order: {
              digest: capability(
                String(data.order_id),
                String(data.access_token),
              ),
              binding: String(data.binding ?? ''),
            },
          }
          : {}),
      }
      : {}),
  }
}

/** Commercial suppression is imported as data, without activating deliveries. */
export let printboundSignup = (
  source: string,
  row: Imported,
  owners: Owners,
): Bundle | undefined => {
  if (row.table !== 'signups') return undefined
  let owner = owners(row)
  if (!owner.owner && !owner.via) {
    throw Error('An imported signup requires private ownership')
  }
  return {
    entity: { eid: row.eid },
    legacy_signup: { source, snapshot: row.data, ...owner },
    ...(row.data.unsubscribe_token
      ? {
        legacy_opt_out: { digest: sha256(String(row.data.unsubscribe_token)) },
      }
      : {}),
    ...(row.data.unsubscribed_at
      ? { mail_opt_out: { at: String(row.data.unsubscribed_at) } }
      : {}),
  }
}
