// One bounded fulfillment step. Every decision uses graph facts; the shell
// supplies atomic writes, provider calls, fresh file URLs and refunds.
import { InputError } from './refusal.ts'
import { type Files, type Print, type Printer, type Receipt } from './lulu.ts'

export type Manifest = {
  revision: string
  interior: { blob: string; hash: string; pages: number }
  cover: { blob: string; hash: string; pages: number }
}
export type Order = {
  entity: { eid: string }
  print_order: {
    quote: string
    person: string
    source: string
    document: string
    manifest: Manifest
    print: Print
    preview?: boolean
    authority?: string
  }
  print_payment_blocked?: { at: string; reason: string }
  print_expired?: { at: string }
  print_paid?: {
    checkout: string
    payment: string
    total: number
    currency: string
  }
  print_submission?: { at: string; reference: string; attempt: string }
  print_retry?: { at: string; submission: string }
  print_receipt?: Receipt & { observed: string }
  print_cancel?: { at: string }
  print_cancelled?: { at: string }
  print_cancel_denied?: { at: string; status: string }
  print_refunded?: { at: string; id: string }
  print_absent?: { at: string }
}
export type Patch = {
  [K in keyof Omit<Order, 'entity' | 'print_order'>]?: Order[K] | null
}
export type Repository = {
  read: (id: string) => Promise<Order>
  patch: (id: string, patch: Patch) => Promise<void>
  receipt: (
    id: string,
    receipt: NonNullable<Order['print_receipt']>,
    previous?: Order['print_receipt'],
  ) => Promise<boolean>
  // Exactly one worker may add a submission intent to an order. A losing
  // worker reconciles the intent and never submits another job.
  claim: (
    id: string,
    intent: NonNullable<Order['print_submission']>,
    previous?: Order['print_submission'],
  ) => Promise<boolean>
}
export type Fulfillment = {
  orders: Repository
  authorize: (order: Order) => Promise<boolean>
  printer: Printer
  assets: (document: Manifest) => Promise<Files>
  refund: (order: Order, reference: string) => Promise<{ id: string } | null>
  report: (
    error: unknown,
    tags: { order: string; location: string },
  ) => Promise<void>
  now: () => string
}

export let progress = (order: Order): string => {
  if (order.print_refunded) return 'refunded'
  if (
    order.print_payment_blocked && !order.print_submission &&
    !order.print_receipt
  ) {
    return `payment_${order.print_payment_blocked.reason}`
  }
  if (order.print_cancelled) return 'cancelled'
  if (order.print_receipt) return order.print_receipt.status.toLowerCase()
  if (order.print_submission) return 'reconciling'
  return order.print_paid
    ? 'paid'
    : order.print_expired
    ? 'expired'
    : 'payment_pending'
}

let received = async (ports: Fulfillment, id: string, value: Receipt) => {
  let current = await ports.orders.read(id), previous = current.print_receipt
  if (
    previous?.changed && value.changed &&
    Date.parse(value.changed) < Date.parse(previous.changed)
  ) return current
  await ports.orders.receipt(id, { ...value, observed: ports.now() }, previous)
  return ports.orders.read(id)
}

let refund = async (ports: Fulfillment, order: Order) => {
  if (!order.print_paid || order.print_refunded) return order
  let result = await ports.refund(order, order.entity.eid)
  if (!result) return order
  await ports.orders.patch(order.entity.eid, {
    print_refunded: { at: ports.now(), id: result.id },
  })
  return ports.orders.read(order.entity.eid)
}

let reconcile = async (ports: Fulfillment, order: Order): Promise<Order> => {
  let lookup = await ports.printer.find(order.entity.eid)
  if ('found' in lookup) return received(ports, order.entity.eid, lookup.found)
  // external_id is a search reference. Absence after a lost POST is not an
  // exactly-once guarantee: keep the intent for an operator to investigate.
  return order
}

let submit = async (ports: Fulfillment, order: Order): Promise<Order> => {
  let id = order.entity.eid
  order = await reconcile(ports, order)
  if (
    order.print_receipt || (order.print_submission &&
      order.print_retry?.submission !== order.print_submission.attempt)
  ) return order
  let files = await ports.assets(order.print_order.manifest)
  if (
    !await ports.orders.claim(id, {
      at: ports.now(),
      reference: id,
      attempt: crypto.randomUUID(),
    }, order.print_submission)
  ) {
    return reconcile(ports, await ports.orders.read(id))
  }
  // Re-read cancellation after the claim. A persisted intent may be left
  // uncertain by a crash; no subsequent worker blindly repeats this POST.
  order = await ports.orders.read(id)
  if (order.print_cancel) {
    await ports.orders.patch(id, { print_cancelled: { at: ports.now() } })
    return ports.orders.read(id)
  }
  return received(
    ports,
    id,
    await ports.printer.submit(id, order.print_order.print, files),
  )
}

let cancel = async (ports: Fulfillment, order: Order): Promise<Order> => {
  let id = order.entity.eid
  if (!order.print_receipt && order.print_submission) {
    order = await reconcile(ports, order)
  }
  if (!order.print_receipt) {
    if (order.print_submission && !order.print_absent) return order
  } else {
    order = await received(
      ports,
      id,
      await ports.printer.status(order.print_receipt.id),
    )
    let status = order.print_receipt!.status
    if (
      !['CREATED', 'UNPAID', 'PRODUCTION_DELAYED', 'CANCELED', 'REJECTED']
        .includes(status)
    ) {
      await ports.orders.patch(id, {
        print_cancel_denied: { at: ports.now(), status },
      })
      return ports.orders.read(id)
    }
    if (!['CANCELED', 'REJECTED'].includes(status)) {
      // The provider decides whether cancellation is still possible. A refusal
      // leaves the request recoverable and never starts a premature refund.
      await ports.printer.cancel(order.print_receipt!.id)
      order = await received(
        ports,
        id,
        await ports.printer.status(order.print_receipt!.id),
      )
      if (order.print_receipt!.status !== 'CANCELED') return order
    }
  }
  await ports.orders.patch(id, { print_cancelled: { at: ports.now() } })
  return refund(ports, await ports.orders.read(id))
}

export let fulfill = async (ports: Fulfillment, id: string): Promise<Order> => {
  try {
    let order = await ports.orders.read(id)
    if (order.print_refunded) return order
    if (!order.print_paid) {
      if (order.print_cancel && !order.print_cancelled) {
        await ports.orders.patch(id, { print_cancelled: { at: ports.now() } })
        return ports.orders.read(id)
      }
      return order
    }
    if (!await ports.authorize(order)) return ports.orders.read(id)
    if (order.print_cancelled) return refund(ports, order)
    if (order.print_cancel && !order.print_cancel_denied) {
      return cancel(ports, order)
    }
    if (!order.print_receipt) order = await submit(ports, order)
    else {
      order = await received(
        ports,
        id,
        await ports.printer.status(order.print_receipt.id),
      )
    }
    if (['REJECTED', 'CANCELED'].includes(order.print_receipt?.status ?? '')) {
      return refund(ports, order)
    }
    return order
  } catch (error) {
    await ports.report(error, { order: id, location: 'printbound.fulfill' })
    throw error
  }
}

/** Callbacks are hints: read authenticated provider state, never trust a
 * posted status or repeat payment/rendering work from a callback body. */
export let refresh = fulfill

/** An operator's explicit retry after investigating a lost submission. Search
 * absence alone never authorizes an automatic repeat of an uncertain POST. */
export let retryAbsent = async (ports: Fulfillment, id: string) => {
  let order = await ports.orders.read(id)
  if (!order.print_submission || order.print_receipt || order.print_cancel) {
    throw new InputError('Only an uncertain, active submission can be retried')
  }
  let lookup = await ports.printer.find(id)
  if ('found' in lookup) return received(ports, id, lookup.found)
  await ports.orders.patch(id, {
    print_retry: {
      at: ports.now(),
      submission: order.print_submission.attempt,
    },
  })
  return ports.orders.read(id)
}
