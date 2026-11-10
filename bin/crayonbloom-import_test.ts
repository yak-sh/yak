// Customer fixtures check guest separation, completed art, consent, historical
// payments and the same link doors that an imported store serves.
import { type Bundle, sha256 } from '@yaks/graph'
import { equal, match, test, throws } from '@yaks/testing'
import { copy, type Imported, type Tables } from './venture-import.ts'
import {
  crayonbloom,
  crayonbloomProjection,
  crayonbloomTables,
} from './crayonbloom-import.ts'
import { legacyPage } from '../apps/crayonbloom/legacy.ts'

let guest = '90131224-88e8-43cc-b632-16323fbd098c'
let other = 'b174ae94-dfaa-48cf-8c27-f971dd731f09'
let account = '37115ec5-d9af-407d-8d12-610eb02f64ad'
let source = 'fixture/crayonbloom/production'
let tables = (): Tables => ({
  ...Object.fromEntries(
    Object.keys(crayonbloomTables).map((name) => [name, []]),
  ),
  users: [{ id: 1, guest: true }, { id: 2, guest: true }, {
    id: 3,
    email: 'reader@example.test',
  }],
  books: [{
    id: 1,
    user_id: 1,
    title: 'A saved story',
    prompt: 'A fixture prompt',
    outline: 'Editable story',
    metadata: { personalization_name: 'Fixture' },
  }, { id: 2, user_id: 2, title: 'Other guest', prompt: 'Different' }],
  book_pages: [{
    id: 1,
    book_id: 1,
    position: 1,
    prompt: 'An existing drawing',
    status: 'ready',
    gallery_consent_at: '2026-01-01',
  }, {
    id: 2,
    book_id: 1,
    position: 2,
    prompt: 'Unfinished page',
    status: 'failed',
  }],
  free_pages: [{
    id: 1,
    token: 'fixture-free-token',
    prompt: 'Free fixture',
    status: 'failed',
  }, {
    id: 2,
    token: 'fixture-claimed',
    prompt: 'A <claimed> page',
    status: 'completed',
    email: 'parent@example.test',
  }],
  checkout_sessions: [{
    id: 1,
    user_id: 1,
    book_id: 1,
    status: 'completed',
    stripe_checkout_session_id: 'cs_fixture',
    stripe_payment_intent_id: 'pi_fixture',
  }],
  orders: [{
    id: 1,
    user_id: 1,
    book_id: 1,
    checkout_session_id: 1,
    status: 'refunded',
    total_cents: 2499,
    currency: 'usd',
    payload: { refund_id: 're_fixture' },
  }],
  print_orders: [{
    id: 1,
    order_id: 1,
    provider_order_id: 'provider_fixture',
    status: 'failed',
  }],
  active_storage_blobs: [
    { id: 1, key: 'private/art', byte_size: 3 },
    {
      id: 2,
      key: 'private/character',
      byte_size: 3,
    },
    { id: 3, key: 'private/pdf', byte_size: 3 },
    {
      id: 4,
      key: 'private/free',
      byte_size: 3,
    },
  ],
  active_storage_attachments: [{
    id: 1,
    blob_id: 1,
    record_type: 'BookPage',
    record_id: 1,
    name: 'artwork',
  }, {
    id: 2,
    blob_id: 2,
    record_type: 'Book',
    record_id: 1,
    name: 'character_sheet',
  }, {
    id: 3,
    blob_id: 3,
    record_type: 'Book',
    record_id: 1,
    name: 'interior_pdf',
  }, {
    id: 4,
    blob_id: 4,
    record_type: 'FreePage',
    record_id: 2,
    name: 'artwork',
  }],
  waitlist_signups: [{
    id: 1,
    email: 'reader@example.test',
    marketing_opted_in_at: '2026-01-01',
    unsubscribed_at: '2026-01-02',
    unsubscribe_token: 'fixture-opt-out',
  }],
})
let imported = crayonbloom(source, tables())
let byId = new Map(imported.rows.map((r) => [r.eid, r]))
let owner = (row: Imported): { owner?: string; via?: string } => {
  if (row.table === 'users') {
    return Number(row.data.id) === 1
      ? { via: guest }
      : Number(row.data.id) === 2
      ? { via: other }
      : { owner: account }
  }
  let parent = row.refs.user_id ?? row.refs.book_id ?? row.refs.order_id ??
    row.refs.record_id
  return parent ? owner(byId.get(parent)!) : { owner: account }
}
let blobs = Object.fromEntries(
  imported.rows.filter((r) => r.table === 'active_storage_blobs').map((
    r,
  ) => [r.eid, {
    blob: sha256(String(r.data.key)),
    hash: sha256(String(r.data.key)),
    mime: r.data.id === 3 ? 'application/pdf' : 'image/png',
  }]),
)
let project = crayonbloomProjection(imported, {
  owner,
  blobs,
  fingerprint: (book, page) =>
    `prepared:${book.entity.eid}:${page?.entity.eid ?? 'character'}`,
})
let stored = new Map<string, Bundle>()
let destination = {
  project,
  get: (eid: string) => stored.get(eid),
  put: (eid: string, value: Bundle) => {
    stored.set(eid, structuredClone(value))
  },
  same: (a: Bundle, b: Bundle) => JSON.stringify(a) === JSON.stringify(b),
}
await copy(imported, destination)
let row = (table: string, key: number) =>
  imported.rows.find((r) => r.table === table && r.data.id === key)!
// The interface fixture answers only the two archive queries used by the door.
let db = {
  query: (q: string): Promise<Bundle[]> =>
    Promise.resolve([...stored.values()].filter((r) => {
      let archive = r.legacy_record as {
        table?: string
        owner?: string
        via?: string
      } | undefined
      if (q.includes('.legacy_page.digest=')) {
        return (r.legacy_page as { digest: string } | undefined)?.digest ===
          q.split('=')[1].split('&')[0]
      }
      if (q.includes('.legacy_opt_out.digest=')) {
        return (r.legacy_opt_out as { digest: string } | undefined)?.digest ===
          q.split('=')[1].split('&')[0]
      }
      if (q.includes('.legacy_asset.record=')) {
        return (r.legacy_asset as { record: string } | undefined)?.record ===
          q.split('=')[1]
      }
      return archive?.table === 'orders' &&
        q.includes(
          `.legacy_record.${archive.owner ? 'owner' : 'via'}=${
            archive.owner ?? archive.via
          }`,
        )
    })),
  apply: (values: Bundle[]) =>
    Promise.resolve(
      values.map((value) =>
        stored.set(value.entity.eid, {
          ...stored.get(value.entity.eid)!,
          ...value,
        })
      ),
    ),
}

test('CrayonBloom import retains separate guests, editable stories, completed artwork and PDF assets', () => {
  let book = stored.get(row('books', 1).eid)!
  let page = stored.get(row('book_pages', 1).eid)!
  match(book, {
    coloring_book: { via: guest },
    doc: { body: 'Editable story' },
    character_art: { hash: sha256('private/character') },
  })
  match(stored.get(row('books', 2).eid), { coloring_book: { via: other } })
  match(page, {
    artwork: { input: `prepared:${book.entity.eid}:${page.entity.eid}` },
    gallery_consent: { at: '2026-01-01' },
  })
  match(stored.get(row('active_storage_attachments', 3).eid), {
    legacy_asset: { mime: 'application/pdf' },
  })
  equal(page.page_job, undefined)
  match(stored.get(row('book_pages', 2).eid), {
    page_failed: { message: 'This page needs another attempt.' },
  })
})

test('CrayonBloom history preserves refunds and provider ids without authorizing another print charge', () => {
  let order = stored.get(row('orders', 1).eid)!
  match(order, {
    print_receipt: {
      receipt: {
        status: 'refunded',
        payment: { intent: 'pi_fixture' },
        provider: { id: 'provider_fixture' },
      },
    },
    legacy_record: { snapshot: { payload: { refund_id: 're_fixture' } } },
  })
  equal(order.print_paid, undefined)
  equal(order.print_order, undefined)
})

test('A CrayonBloom rerun leaves every matched source row unchanged', async () => {
  let result = await copy(imported, destination)
  equal(result.written, 0)
  equal(result.unchanged, stored.size)
})

test('Cross-customer orders and missing source assets cannot be silently imported', async () => {
  let broken = tables()
  broken.orders[0].user_id = 3
  await throws(() => crayonbloom(source, broken), 'Source ownership mismatch')
  await throws(
    () =>
      crayonbloomProjection(imported, {
        owner,
        blobs: {},
        fingerprint: () => '',
      }),
    'A referenced source asset has not been copied',
  )
})

test('ActiveStorage variants retain their original blob and attachment links', () => {
  let sourceRows = tables()
  sourceRows.active_storage_variant_records = [{ id: 1, blob_id: 1 }]
  sourceRows.active_storage_attachments.push({
    id: 5,
    blob_id: 2,
    record_type: 'ActiveStorage::VariantRecord',
    record_id: 1,
    name: 'image',
  })
  let data = crayonbloom(source, sourceRows)
  let variant = data.rows.find((r) =>
    r.table === 'active_storage_variant_records'
  )!
  let attachment = data.rows.find((r) =>
    r.table === 'active_storage_attachments' && r.data.id === 5
  )!
  equal(attachment.refs.record_id, variant.eid)
  equal(variant.refs.blob_id, row('active_storage_blobs', 1).eid)
})

test('Historical order links require the mapped owner or guest principal', async () => {
  let request = new Request('https://fixture.test/orders/1')
  equal((await legacyPage(request, db, { via: guest }))!.status, 200)
  equal(
    (await legacyPage(request, db, { owner: account, via: guest }))!.status,
    200,
  )
  equal((await legacyPage(request, db, { via: other }))!.status, 404)
  equal((await legacyPage(request, db, {}))!.status, 404)
})

test('A free printable capability and an opt-out retain their scoped reach', async () => {
  let ports = {
    asset: (blob: string) => Promise.resolve(new Response(blob)),
    printable: (art: { blob: string }, title: string) =>
      Promise.resolve(new Response(`${title}:${art.blob}`)),
  }
  let open = (path: string, accept = 'text/html') =>
    legacyPage(
      new Request('https://fixture.test/free_pages/' + path, {
        headers: { accept },
      }),
      db,
      {},
      undefined,
      ports,
    )
  let text = async (path: string) => (await open(path))!.text()
  let art = sha256('private/free')
  match(await (await open('fixture-claimed', 'application/json'))!.json(), {
    prompt: 'A <claimed> page',
    artwork: [{ blob: art }],
  })
  let page = await text('fixture-claimed')
  match(page, /Your page is ready/)
  match(page, /A &#60;claimed&#62; page/)
  match(page, /href="\/free_pages\/fixture-claimed\/download"/)
  equal(await text('fixture-claimed/artwork'), art)
  equal(await text('fixture-claimed/download'), `A <claimed> page:${art}`)
  match(await text('fixture-free-token'), /didn’t come out right/)
  equal((await open('fixture-free-token/artwork'))!.status, 404)
  equal((await open('unknown'))!.status, 404)
  let response = await legacyPage(
    new Request('https://fixture.test/unsubscribe/fixture-opt-out', {
      method: 'POST',
      headers: { accept: 'application/json' },
    }),
    db,
    {},
  )
  equal((await response!.json()).unsubscribed, true)
  match(stored.get(row('waitlist_signups', 1).eid), {
    mail_opt_out: { at: '2026-01-02' },
  })
})
