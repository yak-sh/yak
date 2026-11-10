// CrayonBloom's customer-data export contract, read from db/schema.rb.
// Rails keys and signatures stay at the verification boundary; guests never
// acquire an account merely because another row has the same email.
import type { Catalog, Inventory, Owner, Tables } from './venture-import.ts'
import { inventory, ownership } from './venture-import.ts'
import type { Imported } from './venture-import.ts'
import type { Bundle } from '@yaks/graph'
import { sha256 } from '@yaks/graph'

export let crayonbloomTables: Catalog = {
  users: { key: ['id'] },
  styles: { key: ['id'] },
  free_pages: {
    key: ['id'],
    refs: { style_id: { table: 'styles', optional: true } },
  },
  books: {
    key: ['id'],
    refs: {
      user_id: { table: 'users' },
      style_id: { table: 'styles', optional: true },
      free_page_id: { table: 'free_pages', optional: true },
    },
  },
  book_pages: {
    key: ['id'],
    refs: {
      book_id: { table: 'books' },
      display_reviewed_by_id: { table: 'users', optional: true },
      gallery_consent_by_id: { table: 'users', optional: true },
    },
  },
  checkout_sessions: {
    key: ['id'],
    refs: { user_id: { table: 'users' }, book_id: { table: 'books' } },
  },
  orders: {
    key: ['id'],
    refs: {
      user_id: { table: 'users' },
      book_id: { table: 'books' },
      checkout_session_id: { table: 'checkout_sessions', optional: true },
      print_quote_id: { table: 'print_quotes', optional: true },
    },
  },
  print_quotes: { key: ['id'], refs: { book_id: { table: 'books' } } },
  print_orders: { key: ['id'], refs: { order_id: { table: 'orders' } } },
  generation_jobs: {
    key: ['id'],
    refs: {
      book_id: { table: 'books' },
      requested_by_id: { table: 'users', optional: true },
    },
  },
  magic_links: {
    key: ['id'],
    refs: {
      user_id: { table: 'users' },
      guest_id: { table: 'users', optional: true },
    },
  },
  active_storage_blobs: { key: ['id'] },
  active_storage_attachments: {
    key: ['id'],
    refs: { blob_id: { table: 'active_storage_blobs' } },
  },
  active_storage_variant_records: {
    key: ['id'],
    refs: { blob_id: { table: 'active_storage_blobs' } },
  },
  waitlist_signups: { key: ['id'] },
  free_page_grants: { key: ['id'] },
  deletion_requests: { key: ['id'] },
  moderation_cases: {
    key: ['id'],
    refs: {
      user_id: { table: 'users' },
      book_id: { table: 'books' },
      book_page_id: { table: 'book_pages', optional: true },
    },
  },
}

let records: Record<string, string> = {
  Book: 'books',
  BookPage: 'book_pages',
  FreePage: 'free_pages',
}

/** Includes Rails' polymorphic attachment ownership in the resolved references. */
export let crayonbloom = (source: string, tables: Tables): Inventory => {
  let imported = inventory(source, tables, crayonbloomTables)
  let byKey = new Map(imported.rows.map((r) => [`${r.table}/${r.key[0]}`, r]))
  for (
    let row of imported.rows.filter((r) =>
      r.table === 'active_storage_attachments'
    )
  ) {
    let target = byKey.get(
      `${records[String(row.data.record_type)]}/${row.data.record_id}`,
    )
    if (!target) throw Error('Missing source attachment owner')
    row.refs.record_id = target.eid
  }
  for (let table of ['orders', 'checkout_sessions', 'moderation_cases']) {
    ownership(imported, table, 'book_id', 'user_id')
  }
  ownership(imported, 'orders', 'checkout_session_id', 'book_id')
  ownership(imported, 'orders', 'print_quote_id', 'book_id')
  ownership(imported, 'moderation_cases', 'book_page_id', 'book_id')
  return imported
}

export type Blob = { blob: string; hash: string; mime: string }
export type CrayonImport = {
  owner: (row: Imported) => Owner
  blobs: Record<string, Blob>
  fingerprint: (book: Bundle, page?: Bundle) => string
}

let text = (value: unknown): string => String(value ?? '')
let metadata = (row: Imported): Record<string, unknown> =>
  (row.data.metadata ?? {}) as Record<string, unknown>

/** Projects into the storefront's vocabulary; source archives remain private
 * reconciliation evidence and never become generation or fulfillment jobs. */
export let crayonbloomProjection = (
  imported: Inventory,
  context: CrayonImport,
): (row: Imported) => Bundle | undefined => {
  let rows = new Map(imported.rows.map((r) => [r.eid, r]))
  let owned = (row: Imported): Owner => {
    let owner = context.owner(row)
    if (!owner.owner && !owner.via) {
      throw Error('An imported record requires verified ownership')
    }
    return owner
  }
  let archive = (row: Imported): Bundle => ({
    entity: { eid: row.eid },
    legacy_record: {
      source: imported.source,
      table: row.table,
      key: row.key,
      snapshot: row.data,
      ...owned(row),
    },
  })
  let receipt = (row: Imported): Record<string, unknown> => {
    let checkout = rows.get(row.refs.checkout_session_id)?.data
    let printing = imported.rows.find((r) =>
      r.table === 'print_orders' && r.refs.order_id === row.eid
    )?.data
    return {
      id: text(row.data.id),
      seller: 'CrayonBloom',
      status: text(row.data.status),
      historical: true,
      title: text(rows.get(row.refs.book_id)?.data.title),
      ...(printing?.tracking_url
        ? { tracking: text(printing.tracking_url) }
        : {}),
      payment: {
        checkout: checkout?.stripe_checkout_session_id ?? null,
        intent: checkout?.stripe_payment_intent_id ?? null,
        status: checkout?.status ?? null,
        total: row.data.total_cents,
        currency: row.data.currency,
      },
      provider: {
        id: printing?.provider_order_id ?? null,
        status: printing?.status ?? null,
      },
    }
  }
  let books = new Map<string, Bundle>()
  for (let row of imported.rows.filter((r) => r.table === 'books')) {
    let style = rows.get(row.refs.style_id)?.data
    let orders = imported.rows.filter((r) =>
      r.table === 'orders' && r.refs.book_id === row.eid
    )
      .sort((a, b) =>
        text(b.data.created_at).localeCompare(text(a.data.created_at))
      )
    books.set(row.eid, {
      ...archive(row),
      doc: { title: text(row.data.title), body: text(row.data.outline) },
      coloring_book: {
        ...owned(row),
        prompt: text(row.data.prompt),
        age: text(row.data.age_band),
        style: text(style?.slug),
        character: text(row.data.character_brief),
        mode: text(row.data.mode),
        personalization: text(metadata(row).personalization_name),
        dedication: text(metadata(row).dedication),
      },
      ...(orders[0] ? { print_receipt: { receipt: receipt(orders[0]) } } : {}),
    })
  }
  let pages = new Map<string, Bundle>()
  for (let row of imported.rows.filter((r) => r.table === 'book_pages')) {
    pages.set(row.eid, {
      ...archive(row),
      coloring_page: {
        book: row.refs.book_id,
        position: Number(row.data.position),
        prompt: text(row.data.prompt),
        caption: text(row.data.story_sentence),
        activity: text(row.data.activity_type),
        seed: Number(row.data.activity_seed ?? 0),
      },
      ...(row.data.gallery_consent_at
        ? { gallery_consent: { at: text(row.data.gallery_consent_at) } }
        : {}),
      ...(row.data.status === 'failed'
        ? { page_failed: { message: 'This page needs another attempt.' } }
        : {}),
    })
  }
  let assets = new Map<string, Bundle>()
  for (
    let row of imported.rows.filter((r) =>
      r.table === 'active_storage_attachments'
    )
  ) {
    let blob = context.blobs[row.refs.blob_id]
    if (!blob) throw Error('A referenced source asset has not been copied')
    let record = rows.get(row.refs.record_id)!
    let book = record.table === 'books'
      ? books.get(record.eid)
      : books.get(record.refs.book_id)
    let target = record.table === 'books' ? book : pages.get(record.eid)
    if (
      target && book &&
      ['artwork', 'character_sheet'].includes(text(row.data.name))
    ) {
      let art = {
        ...blob,
        input: context.fingerprint(
          book,
          record.table === 'book_pages' ? target : undefined,
        ),
      }
      target[
        row.data.name === 'character_sheet' ? 'character_art' : 'artwork'
      ] = art
    }
    assets.set(row.eid, {
      ...archive(row),
      legacy_asset: { record: record.eid, role: text(row.data.name), ...blob },
    })
  }
  return (row) => {
    if (books.has(row.eid)) return books.get(row.eid)
    if (pages.has(row.eid)) return pages.get(row.eid)
    if (assets.has(row.eid)) return assets.get(row.eid)
    if (
      ['styles', 'active_storage_blobs', 'active_storage_variant_records']
        .includes(row.table)
    ) return undefined
    return {
      ...archive(row),
      ...(row.table === 'orders'
        ? { print_receipt: { receipt: receipt(row) } }
        : {}),
      ...(row.table === 'free_pages'
        ? { legacy_page: { digest: sha256(text(row.data.token)) } }
        : {}),
      ...(row.table === 'waitlist_signups' && row.data.unsubscribed_at
        ? { mail_opt_out: { at: text(row.data.unsubscribed_at) } }
        : {}),
      ...(row.table === 'waitlist_signups' && row.data.unsubscribe_token
        ? {
          legacy_opt_out: { digest: sha256(text(row.data.unsubscribe_token)) },
        }
        : {}),
    }
  }
}
