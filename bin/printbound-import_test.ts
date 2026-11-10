// Fixture exports exercise the same graph copy and compatibility doors used by
// a migration. No account, payment, printer, secret or customer data is loaded.
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, match, test, throws } from '@yaks/testing'
import { copy, importedEid, type Tables } from './venture-import.ts'
import {
  printbound,
  printboundBook,
  printboundTables,
} from './printbound-import.ts'
import { legacyPage, legacyStatus } from '../apps/printbound/legacy.ts'
import legacyVocab from '../apps/printbound/legacy-vocab.json' with {
  type: 'json',
}

let source = 'fixture/printbound/orders'
let owner = '8d85d043-1947-45a9-9f13-73fdffb9e282'
let tables = (): Tables => ({
  ...Object.fromEntries(
    Object.entries(printboundTables).filter(([, t]) => !t.optional).map((
      [name],
    ) => [name, []]),
  ),
  quotes: [{ quote_id: 'quote-1', list_price: 24.99 }],
  orders: [{
    order_id: 'order-1',
    quote_id: 'quote-1',
    title: 'Fixture book',
    content_markdown: 'A saved draft.',
    binding: 'paperback',
    status: 'submitted',
    buyer_email: 'reader@example.test',
    access_token: 'fixture-token',
    stripe_session_id: 'cs_fixture',
    stripe_payment_intent: 'pi_fixture',
    stripe_amount_total: 2499,
    stripe_currency: 'usd',
    lulu_order_id: 'provider-fixture',
    lulu_order_ref: 'reference-fixture',
    legal_hold_reason: 'fixture evidence',
  }],
  fulfilment_jobs: [{ order_id: 'order-1', state: 'completed' }],
})

let imported = printbound(source, tables())
let book = printboundBook(
  source,
  imported.rows.find((r) => r.table === 'orders')!,
  () => ({ owner }),
)!
let defs = {
  doc: { properties: { title: { type: 'string' } } },
  book_source: {
    properties: {
      owner: { type: 'string' },
      author: { type: 'string' },
      markdown: { type: 'string' },
      dedication: { type: 'string' },
    },
  },
  book_receipt: { properties: { receipt: { type: 'object' } } },
  ...legacyVocab.$defs,
}
let vocab = loadVocab({
  $defs: Object.fromEntries(
    Object.entries(defs).map((
      [name, spec],
    ) => [name, { ...spec, type: 'object', component: true }]),
  ),
})
let g = graph({ vocab, storage: ram(vocab) })
g.install()
let read = async (eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]
let same = (a: Bundle, b: Bundle) =>
  Object.entries(b).every(([name, value]) =>
    JSON.stringify(name === 'entity' ? { eid: a.entity.eid } : a[name]) ===
      JSON.stringify(value)
  )
let destination = {
  project: (row: typeof imported.rows[number]) =>
    printboundBook(source, row, () => ({ owner })),
  get: read,
  put: (_id: string, value: Bundle) => g.apply([value]),
  same,
}
await copy(imported, destination)
let db = { query: async (q: string) => await g.read(q) }

test('PrintBound import preserves payment, content, capability and legal evidence without starting a print order', async () => {
  let row = (await read(book.entity.eid))!
  match(row, {
    book_source: { markdown: 'A saved draft.' },
    book_receipt: {
      receipt: {
        payment: { total: 2499 },
        provider: { id: 'provider-fixture' },
      },
    },
    book_legacy: { snapshot: { legal_hold_reason: 'fixture evidence' } },
  })
  equal(row.print_order, undefined)
  equal(row.print_paid, undefined)
  equal(row.print_submission, undefined)
})

test('PrintBound import reruns without duplicate identities or changed destination rows', async () => {
  equal(await copy(imported, destination), {
    written: 0,
    unchanged: 1,
    skipped: 2,
  })
  let delta = tables()
  delta.orders[0].status = 'shipped'
  let changed = printbound(source, delta)
  equal(changed.rows.find((r) => r.table === 'orders')!.eid, book.entity.eid)
  equal(
    importedEid(source, 'orders', [1]),
    importedEid(source, 'orders', ['1']),
  )
})

test('An absent optional source table remains unavailable, never counted as zero', async () => {
  equal(imported.counts.orders, 1)
  equal(imported.counts.drafts, undefined)
  equal(imported.unavailable.includes('drafts'), true)
  let incomplete = tables()
  delete incomplete.orders
  await throws(
    () => printbound(source, incomplete),
    'Missing source table: orders',
  )
})

test('An unresolved order reference stops import before a destination write', async () => {
  let broken = tables()
  broken.orders[0].quote_id = 'missing'
  await throws(() => printbound(source, broken), 'Missing source reference')
})

test('An existing order capability sees only that historical status', async () => {
  let status = await legacyStatus(db, {
    order_id: 'order-1',
    access_token: 'fixture-token',
  })
  equal(status?.status, 'submitted')
  equal(status?.title, 'Fixture book')
  equal(status?.payment, undefined)
  equal(status?.buyer_email, undefined)
  equal(
    await legacyStatus(db, {
      order_id: 'order-2',
      access_token: 'fixture-token',
    }),
    null,
  )
  equal(
    await legacyStatus(db, { order_id: 'order-1', access_token: 'wrong' }),
    null,
  )
})

test('The existing MCP status call answers through its original tool name and arguments', async () => {
  let response = await legacyPage(
    new Request('https://fixture.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'get_order_status',
          arguments: { order_id: 'order-1', access_token: 'fixture-token' },
        },
      }),
    }),
    db,
  )
  let result = await response!.json()
  equal(result.id, 7)
  equal(result.result.structuredContent.order_id, 'order-1')
  equal(response!.headers.get('cache-control'), 'no-store, private')
})
