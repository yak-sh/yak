import { equal, test } from '@yaks/testing'
import { lulu, type Print } from './lulu.ts'

let print: Print = {
  title: 'Book',
  contact: 'preview@example.invalid',
  pages: 40,
  package: 'sku',
  quantity: 3,
  address: {
    name: 'Buyer',
    street1: '1 A St',
    city: 'City',
    country_code: 'US',
    postcode: '10001',
    phone_number: '5555555555',
  },
  shipping: 'EXPRESS',
  currency: 'USD',
}
let job = (id: number, reference: string) => ({
  id,
  external_id: reference,
  status: { name: 'CREATED' },
  line_items: [],
})
let json = (body: unknown, status = 200) => Response.json(body, { status })
let adapter = (
  read: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) =>
  lulu({
    key: 'sentinel-key',
    secret: 'sentinel-secret',
    base: 'https://api.sandbox.lulu.com',
    fetch: ((url, init) =>
      String(url).endsWith('/token')
        ? Promise.resolve(json({ access_token: 'token' }))
        : Promise.resolve(read(new URL(String(url)), init))) as typeof fetch,
  })
let failed = async (body: () => Promise<unknown>) => {
  try {
    await body()
  } catch {
    return
  }
  throw new Error('Expected failure')
}

test('Lulu quotes bind quantity, full shipping address and selected shipping level', async () => {
  let printer = adapter((url, init) => {
    equal(url.pathname, '/print-job-cost-calculations/')
    equal(JSON.parse(String(init?.body)), {
      line_items: [{ page_count: 40, pod_package_id: 'sku', quantity: 3 }],
      shipping_address: print.address,
      shipping_level: 'EXPRESS',
      currency: 'USD',
    })
    return json({
      currency: 'USD',
      total_cost_excl_tax: '32.00',
      total_tax: '2.00',
      total_cost_incl_tax: '34.00',
      shipping_cost: { total_cost_excl_tax: '4.00' },
    }, 201)
  })
  equal(await printer.quote(print), {
    currency: 'USD',
    subtotal: 3200,
    tax: 200,
    total: 3400,
    shipping: 400,
  })
})

test('Lulu rejects malformed quote costs instead of silently quoting zero', async () => {
  let printer = adapter(() =>
    json({
      currency: 'USD',
      total_cost_excl_tax: '',
      total_tax: '0',
      total_cost_incl_tax: '0',
    })
  )
  await failed(() => printer.quote(print))
})

test('Lulu reconciles exact references through every search page', async () => {
  let pages = 0
  let printer = adapter((url) => {
    equal(url.searchParams.get('search'), 'order')
    pages++
    return json({
      count: 101,
      results: pages === 1
        ? Array.from({ length: 100 }, (_, i) => job(i, 'other'))
        : [job(101, 'order')],
    })
  })
  let found = await printer.find('order')
  equal('found' in found && found.found.id, '101')
  equal(pages, 2)
})

test('Lulu rejects partial lookup pages and duplicate exact references', async () => {
  let partial = adapter(() => json({ count: 2, results: [] }))
  await failed(() => partial.find('order'))
  let duplicate = adapter(() =>
    json({ count: 2, results: [job(1, 'order'), job(2, 'order')] })
  )
  await failed(() => duplicate.find('order'))
})

test('Lulu only confirms absence from a valid complete search', async () => {
  equal(await adapter(() => json({ count: 0, results: [] })).find('order'), {
    absent: true,
  })
  await failed(() => adapter(() => json({}, 503)).find('order'))
})

test('Lulu submits the selected immutable files and complete shipping phone', async () => {
  let printer = adapter((url, init) => {
    equal(url.pathname, '/print-jobs/')
    let body = JSON.parse(String(init?.body))
    equal(body.external_id, 'order')
    equal(body.line_items[0].quantity, 3)
    equal(body.shipping_address.phone_number, '5555555555')
    equal(
      body.line_items[0].printable_normalization.interior.source_url,
      'https://files.example/interior',
    )
    return json(job(1, 'order'), 201)
  })
  equal(
    (await printer.submit('order', print, {
      interior: 'https://files.example/interior',
      cover: 'https://files.example/cover',
    })).status,
    'CREATED',
  )
})

test('Lulu cancellation uses the documented status update and requires confirmation', async () => {
  let printer = adapter((url, init) => {
    equal(url.pathname, '/print-jobs/123/status/')
    equal(init?.method, 'PUT')
    equal(JSON.parse(String(init?.body)), { name: 'CANCELED' })
    return json({ name: 'CANCELED' })
  })
  await printer.cancel('123')
  await failed(() =>
    adapter(() => json({ name: 'IN_PRODUCTION' })).cancel('123')
  )
})

test('missing shipping phone fails before a provider call', async () => {
  let printer = adapter(() => {
    throw new Error('should never call')
  })
  await failed(() =>
    printer.quote({ ...print, address: { ...print.address, phone_number: '' } })
  )
})
