import { equal, ok, test } from '@yaks/testing'
import {
  fulfill,
  type Fulfillment,
  type Order,
  progress,
} from './fulfillment.ts'
import { type Receipt } from './lulu.ts'

let job = (id: string, status = 'UNPAID'): Receipt => ({
  id,
  reference: 'order',
  status,
  changed: '2026-11-10T00:00:00Z',
  message: '',
  tracking: [],
})
let setup = () => {
  let order: Order = {
    entity: { eid: 'order' },
    print_order: {
      quote: 'quote',
      person: 'buyer',
      source: 'source',
      document: 'document',
      manifest: {
        revision: 'revision',
        interior: { blob: 'interior', hash: 'i', pages: 40 },
        cover: { blob: 'cover', hash: 'c', pages: 1 },
      },
      print: {
        title: 'Book',
        contact: 'preview@example.invalid',
        pages: 40,
        package: 'sku',
        quantity: 3,
        address: {
          name: 'Buyer',
          street1: '1 A St',
          city: 'City',
          state_code: 'NY',
          country_code: 'US',
          postcode: '10001',
          phone_number: '5555555555',
        },
        shipping: 'MAIL',
        currency: 'USD',
      },
    },
    print_paid: {
      checkout: 'checkout',
      payment: 'payment',
      total: 4000,
      currency: 'usd',
    },
  }
  let jobs: Receipt[] = [], submissions = 0, refunds = 0, reports = 0, urls = 0
  let ports: Fulfillment = {
    authorize: () => Promise.resolve(true),
    orders: {
      read: () => Promise.resolve(structuredClone(order)),
      patch: (_, patch) => {
        Object.assign(order, patch)
        return Promise.resolve()
      },
      receipt: (_, receipt, previous) => {
        if (
          order.print_receipt?.status !== previous?.status ||
          order.print_receipt?.changed !== previous?.changed
        ) return Promise.resolve(false)
        order.print_receipt = receipt
        return Promise.resolve(true)
      },
      claim: (_, intent, previous) => {
        if (order.print_submission?.attempt !== previous?.attempt) {
          return Promise.resolve(false)
        }
        order.print_submission = intent
        return Promise.resolve(true)
      },
    },
    printer: {
      quote: () =>
        Promise.resolve({
          currency: 'USD',
          subtotal: 3000,
          shipping: 500,
          tax: 500,
          total: 3500,
        }),
      find: () =>
        Promise.resolve(jobs.length ? { found: jobs[0] } : { absent: true }),
      submit: (_, print, files) => {
        equal(print.quantity, 3)
        equal(files, { interior: 'fresh-interior', cover: 'fresh-cover' })
        submissions++
        jobs.push(job('provider'))
        return Promise.resolve(jobs[0])
      },
      status: () => Promise.resolve(jobs[0]),
      cancel: () => {
        jobs[0].status = 'CANCELED'
        return Promise.resolve()
      },
    },
    assets: () => {
      urls++
      return Promise.resolve({
        interior: 'fresh-interior',
        cover: 'fresh-cover',
      })
    },
    refund: (_, reference) => {
      equal(reference, 'order')
      refunds++
      return Promise.resolve({ id: 'refund' })
    },
    report: () => {
      reports++
      return Promise.resolve()
    },
    now: () => '2026-11-10T00:00:00Z',
  }
  return {
    order,
    ports,
    jobs,
    counts: () => ({ submissions, refunds, reports, urls }),
  }
}

let failed = async (body: () => Promise<unknown>) => {
  try {
    await body()
  } catch {
    return
  }
  throw new Error('Expected failure')
}

test('a pending payment never creates a print submission', async () => {
  let f = setup()
  delete f.order.print_paid
  equal(progress(await fulfill(f.ports, 'order')), 'payment_pending')
  equal(f.counts().submissions, 0)
})

test('paid fulfillment preserves unpaid, production and shipment observations', async () => {
  let f = setup()
  equal(progress(await fulfill(f.ports, 'order')), 'unpaid')
  f.jobs[0].status = 'PRODUCTION_DELAYED'
  equal(progress(await fulfill(f.ports, 'order')), 'production_delayed')
  f.jobs[0].status = 'SHIPPED'
  f.jobs[0].tracking = ['https://tracking.example/job']
  equal((await fulfill(f.ports, 'order')).print_receipt?.tracking, [
    'https://tracking.example/job',
  ])
  equal(f.counts().submissions, 1)
})

test('accepted-but-timeout recovers the receipt without a second submission', async () => {
  let f = setup(), submit = f.ports.printer.submit
  f.ports.printer.submit = async (...args) => {
    await submit(...args)
    throw new Error('lost response')
  }
  await failed(() => fulfill(f.ports, 'order'))
  ok(f.order.print_submission)
  equal(f.order.print_receipt, undefined)
  equal(progress(await fulfill(f.ports, 'order')), 'unpaid')
  equal(f.counts(), { submissions: 1, refunds: 0, reports: 1, urls: 1 })
})

test('a lookup failure is not absence and cannot submit', async () => {
  let f = setup()
  f.ports.printer.find = () => Promise.reject(new Error('lookup unavailable'))
  await failed(() => fulfill(f.ports, 'order'))
  equal(f.counts().submissions, 0)
  equal(f.counts().reports, 1)
})

test('uncertain absence keeps reconciling rather than risking another print', async () => {
  let f = setup()
  f.order.print_submission = {
    at: f.ports.now(),
    reference: 'order',
    attempt: 'attempt',
  }
  equal(progress(await fulfill(f.ports, 'order')), 'reconciling')
  equal(f.counts().submissions, 0)
})

test('concurrent retries may create only one submission', async () => {
  let f = setup()
  await Promise.all([fulfill(f.ports, 'order'), fulfill(f.ports, 'order')])
  equal(f.counts().submissions, 1)
})

test('expired asset URL failure preserves work before a submission intent', async () => {
  let f = setup(), assets = f.ports.assets
  f.ports.assets = () => Promise.reject(new Error('refresh failed'))
  await failed(() => fulfill(f.ports, 'order'))
  equal(f.order.print_submission, undefined)
  f.ports.assets = assets
  await fulfill(f.ports, 'order')
  equal(f.counts().submissions, 1)
})

test('cancellation before submission refunds without creating a job', async () => {
  let f = setup()
  f.order.print_cancel = { at: f.ports.now() }
  equal(progress(await fulfill(f.ports, 'order')), 'refunded')
  await fulfill(f.ports, 'order')
  equal(f.counts().submissions, 0)
  equal(f.counts().refunds, 1)
})

test('a provider cancellation must be confirmed before a refund', async () => {
  let f = setup()
  await fulfill(f.ports, 'order')
  f.order.print_cancel = { at: f.ports.now() }
  f.ports.printer.cancel = () =>
    Promise.reject(new Error('already in production'))
  await failed(() => fulfill(f.ports, 'order'))
  equal(f.counts().refunds, 0)
  delete f.order.print_cancel
  f.jobs[0].status = 'SHIPPED'
  equal(progress(await fulfill(f.ports, 'order')), 'shipped')
})

test('duplicate callbacks cannot repeat cancellation or refund', async () => {
  let f = setup()
  await fulfill(f.ports, 'order')
  f.order.print_cancel = { at: f.ports.now() }
  equal(progress(await fulfill(f.ports, 'order')), 'refunded')
  await fulfill(f.ports, 'order')
  equal(f.counts().submissions, 1)
  equal(f.counts().refunds, 1)
})

test('rejected files remain visible on the receipt while the buyer is refunded', async () => {
  let f = setup()
  await fulfill(f.ports, 'order')
  f.jobs[0].status = 'REJECTED'
  let order = await fulfill(f.ports, 'order')
  equal(order.print_receipt?.status, 'REJECTED')
  equal(progress(order), 'refunded')
})

test('an interrupted refund retries with the same platform request identity', async () => {
  let f = setup(), refund = f.ports.refund
  f.order.print_cancel = { at: f.ports.now() }
  f.ports.refund = () => Promise.reject(new Error('refund pending'))
  await failed(() => fulfill(f.ports, 'order'))
  ok(f.order.print_cancelled)
  f.ports.refund = refund
  equal(progress(await fulfill(f.ports, 'order')), 'refunded')
  equal(f.counts().refunds, 1)
})

test('an operator-authorized absence retry uses one fresh submission intent', async () => {
  let f = setup()
  f.order.print_submission = {
    at: f.ports.now(),
    reference: 'order',
    attempt: 'old-attempt',
  }
  f.order.print_retry = { at: f.ports.now(), submission: 'old-attempt' }
  await fulfill(f.ports, 'order')
  equal(f.counts().submissions, 1)
  ok(f.order.print_submission.attempt !== 'old-attempt')
  await fulfill(f.ports, 'order')
  equal(f.counts().submissions, 1)
})

test('an external payment reversal blocks a new supplier submission', async () => {
  let f = setup()
  f.ports.authorize = () => {
    f.order.print_payment_blocked = { at: f.ports.now(), reason: 'refunded' }
    return Promise.resolve(false)
  }
  equal(progress(await fulfill(f.ports, 'order')), 'payment_refunded')
  equal(f.counts().submissions, 0)
})

test('an asynchronous refund remains recoverable without being reported as a failure', async () => {
  let f = setup(), refund = f.ports.refund
  f.order.print_cancel = { at: f.ports.now() }
  f.ports.refund = () => Promise.resolve(null)
  equal(progress(await fulfill(f.ports, 'order')), 'cancelled')
  equal(f.counts().reports, 0)
  f.ports.refund = refund
  equal(progress(await fulfill(f.ports, 'order')), 'refunded')
})

test('a late cancellation is preserved without refunding or repeatedly failing', async () => {
  let f = setup()
  await fulfill(f.ports, 'order')
  f.order.print_cancel = { at: f.ports.now() }
  f.jobs[0].status = 'IN_PRODUCTION'
  equal(progress(await fulfill(f.ports, 'order')), 'in_production')
  equal(f.order.print_cancel_denied?.status, 'IN_PRODUCTION')
  await fulfill(f.ports, 'order')
  equal(f.counts().refunds, 0)
  equal(f.counts().reports, 0)
})

test('an older provider observation cannot replace a later shipment receipt', async () => {
  let f = setup()
  await fulfill(f.ports, 'order')
  f.order.print_receipt = {
    ...job('provider', 'SHIPPED'),
    observed: f.ports.now(),
    changed: '2026-11-11T00:00:00Z',
  }
  f.jobs[0].changed = '2026-11-10T00:00:00Z'
  equal(progress(await fulfill(f.ports, 'order')), 'shipped')
})
