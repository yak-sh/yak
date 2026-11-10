// App commands share this interface with the storefront and connected callers.
// The worker constructs Who from vouched headers; arguments carry no identity.
import { InputError } from './refusal.ts'
import { DocumentInputError, type Preparation } from './document.ts'
import {
  documentStatus,
  prepareCommand,
  prepareStep,
} from './preparation-service.ts'
import type { Quote } from '@yaks/host/payments'
import { owns as ownedBy } from '@yaks/member'
import {
  fulfill,
  type Fulfillment,
  type Manifest,
  type Order,
  progress,
  retryAbsent,
} from './fulfillment.ts'
import { type Address, type Print, validPrint } from './lulu.ts'
import { apply, query, type Store } from './orders.ts'

export type Prepared = Manifest & {
  title: string
  specification: { id: string; sku: string }
  pages: { blob: string }[]
}
export type Who = {
  person?: string
  via?: string
  source: string
  seller: string
  authority?: string
}
export type ServicePorts = Fulfillment & {
  store: Store
  begin: (draft: Record<string, unknown>, who: Who) => Promise<Preparation>
  advance: (state: Preparation, who: Who) => Promise<Preparation | Prepared>
  verifyPreparation: (who: Who) => Promise<void>
  issue: (quote: Quote) => Promise<Quote>
  checkout: (quote: Quote, who: Who) => Promise<{ url: string }>
  payment: (order: Order) => Promise<Order['print_paid']>
  file: (blob: string) => Promise<{ base64: string; mime: string }>
  preview: boolean
  margin: number
  contact: string
}

type DocumentRow = {
  entity: { eid: string }
  print_document: { manifest: Prepared }
  sale_access?: { buyer?: string; via?: string }
}
type QuoteRow = {
  entity: { eid: string }
  print_quote: { manifest: Prepared; print: Print }
  service_quote: { snapshot: string }
}
let id = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
  ) {
    throw new InputError('A document, quote or order UUID is required')
  }
  return value
}
let object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value != 'object' || Array.isArray(value)) {
    throw new InputError('Expected an object')
  }
  return value as Record<string, unknown>
}
let access = (who: Who) => ({
  ...(who.person ? { buyer: who.person } : {}),
  ...(who.via ? { via: who.via } : {}),
})
let owns = (row: DocumentRow, who: Who) =>
  ownedBy(
    { by: row.sale_access?.buyer, via: row.sale_access?.via },
    { by: who.person, via: who.via },
  )
let requirePerson = (who: Who): string => {
  if (!who.person) {
    throw new InputError('Sign in before requesting a print quote or purchase')
  }
  return who.person
}
let summary = (order: Order) => ({
  id: order.entity.eid,
  document: order.print_order.document,
  revision: order.print_order.manifest.revision,
  status: progress(order),
  preview: order.print_order.preview === true,
  provider: order.print_receipt?.status,
  tracking: order.print_receipt?.tracking ?? [],
  cancellation: order.print_cancel_denied?.status,
  quote: order.print_order.quote,
})

let documentFile = async (
  ports: ServicePorts,
  args: Record<string, unknown>,
  who: Who,
) => {
  let document = id(args.document)
  let [row] = await query<DocumentRow>(ports.store, `.entity.eid=${document}`)
  if (!row?.print_document || !owns(row, who)) {
    throw new InputError('This document is not available to this buyer')
  }
  let manifest = row.print_document.manifest, blob = String(args.blob ?? '')
  if (
    ![manifest.interior, manifest.cover, ...manifest.pages].some((file) =>
      file.blob === blob
    )
  ) {
    throw new InputError(
      'This file is not part of the selected print document',
    )
  }
  return ports.file(blob)
}

let quoted = async (
  ports: ServicePorts,
  args: Record<string, unknown>,
  who: Who,
) => {
  let person = requirePerson(who), document = id(args.document)
  let [row] = await query<DocumentRow>(ports.store, `.entity.eid=${document}`)
  if (!row?.print_document || !owns(row, who)) {
    throw new InputError('This document is not available to this buyer')
  }
  if (!row.sale_access?.buyer) {
    await apply(ports.store, [{
      entity: row.entity,
      sale_access: { buyer: person },
      $was: { sale_access: { buyer: null } },
    }])
  }
  let manifest = row.print_document.manifest
  let print: Print = {
    title: manifest.title,
    contact: ports.contact,
    pages: manifest.interior.pages,
    package: manifest.specification.sku,
    quantity: Number(args.quantity),
    address: object(args.address) as Address,
    shipping: String(args.shipping ?? ''),
    currency: 'USD',
  }
  validPrint(print)
  let cost = await ports.printer.quote(print)
  let quote: Quote = {
    id: crypto.randomUUID(),
    buyer: person,
    source: who.source,
    seller: who.seller,
    name: manifest.title,
    document,
    revision: manifest.revision,
    specification: manifest.specification.sku,
    quantity: print.quantity,
    currency: cost.currency.toLowerCase(),
    destination: {
      name: print.address.name,
      phone: print.address.phone_number,
      address: {
        line1: print.address.street1,
        ...(print.address.street2 ? { line2: print.address.street2 } : {}),
        city: print.address.city,
        state: print.address.state_code,
        postal_code: print.address.postcode,
        country: print.address.country_code,
      },
    },
    shipping: {
      id: print.shipping,
      name: print.shipping,
      cents: cost.shipping,
    },
    subtotal: cost.subtotal - cost.shipping + ports.margin,
    tax: cost.tax,
    total: cost.total + ports.margin,
    expires: new Date(Date.parse(ports.now()) + 60 * 60_000).toISOString(),
  }
  await ports.issue(quote)
  await apply(ports.store, [{
    entity: { eid: quote.id },
    print_quote: { manifest, print },
  }])
  return { ...quote, preview: ports.preview }
}

let purchased = async (
  ports: ServicePorts,
  args: Record<string, unknown>,
  who: Who,
) => {
  let person = requirePerson(who), quoteId = id(args.quote)
  let [row] = await query<QuoteRow>(ports.store, `.entity.eid=${quoteId}`)
  if (!row?.service_quote || !row.print_quote) {
    throw new InputError('Request a print quote first')
  }
  let quote: Quote = JSON.parse(row.service_quote.snapshot)
  if (
    quote.buyer !== person || quote.source !== who.source ||
    quote.seller !== who.seller ||
    (args.document != null && args.document !== quote.document &&
      args.document !== quote.revision)
  ) {
    throw new InputError(
      'This quote belongs to another buyer, source or document',
    )
  }
  // The immutable quote entity becomes the order; repeated purchase requests
  // reach one checkout and one durable fulfillment intent.
  await apply(ports.store, [{
    entity: { eid: quoteId },
    print_order: {
      quote: quoteId,
      person,
      source: who.source,
      preview: ports.preview,
      document: quote.document,
      manifest: row.print_quote.manifest,
      print: row.print_quote.print,
      ...(who.authority ? { authority: who.authority } : {}),
    },
    sale_access: access(who),
  }])
  await schedule(ports, quoteId)
  let checkout = await ports.checkout(quote, who)
  return {
    ...summary(await ports.orders.read(quoteId)),
    seller: who.seller,
    checkout: checkout.url,
  }
}

let ownedOrder = async (ports: ServicePorts, value: unknown, who: Who) => {
  let [order] = await query<Order>(ports.store, `.entity.eid=${id(value)}`)
  if (
    !order?.print_order ||
    order.print_order.person !== who.person ||
    order.print_order.source !== who.source
  ) {
    throw new InputError('This order is not available to this buyer')
  }
  return order
}

export let schedule = async (ports: ServicePorts, order: string, delay = 0) => {
  let [tool] = await query<{ entity: { eid: string } }>(
    ports.store,
    '.tool.name=print_step',
  )
  if (!tool) throw new Error('The print fulfillment command is not installed')
  await apply(ports.store, [{
    entity: { eid: order },
    call: { to: tool.entity.eid, args: { order } },
    wake: {
      at: new Date(Date.parse(ports.now()) + delay).toISOString(),
      every: '1m',
    },
  }])
}

export let step = async (ports: ServicePorts, orderId: string) => {
  let order = await ports.orders.read(orderId)
  if (!order.print_paid) {
    let paid = await ports.payment(order)
    if (paid) await ports.orders.patch(orderId, { print_paid: paid })
    else {
      let [row] = await query<{ service_quote: { snapshot: string } }>(
        ports.store,
        `.entity.eid=${order.print_order.quote}`,
      )
      let quote: Quote = JSON.parse(row.service_quote.snapshot)
      if (Date.parse(quote.expires) <= Date.parse(ports.now())) {
        await ports.orders.patch(orderId, {
          print_expired: { at: ports.now() },
        })
        await apply(ports.store, [{
          entity: { eid: orderId },
          call: null,
          wake: null,
        }])
        return summary(await ports.orders.read(orderId))
      }
    }
  }
  order = await fulfill(ports, orderId)
  if (
    [
      'refunded',
      'shipped',
      'delivered',
      'payment_refunded',
      'payment_lost',
    ].includes(progress(order)) ||
    (progress(order) === 'cancelled' && !order.print_paid)
  ) {
    await apply(ports.store, [{
      entity: { eid: orderId },
      call: null,
      wake: null,
    }])
  } else await schedule(ports, orderId, 60_000)
  return summary(order)
}

export let commands =
  (ports: ServicePorts) =>
  async (name: string, args: Record<string, unknown>, who: Who) => {
    if (!who.person && !who.via) {
      throw new InputError('A signed-in person or guest receipt is required')
    }
    if (name === 'prepare') return prepareCommand(ports, args, who)
    if (name === 'document_status') return documentStatus(ports, args, who)
    if (name === 'document_file') return documentFile(ports, args, who)
    if (name === 'quote') return quoted(ports, args, who)
    if (name === 'purchase') return purchased(ports, args, who)
    let order = await ownedOrder(ports, args.order, who)
    if (name === 'cancel') {
      await ports.orders.patch(order.entity.eid, {
        print_cancel: { at: ports.now() },
      })
      await schedule(ports, order.entity.eid)
    } else if (name !== 'order_status') {
      throw new InputError('Unknown print command')
    }
    return {
      ...summary(await ports.orders.read(order.entity.eid)),
      seller: who.seller,
    }
  }

export let caller = (request: Request): Who => {
  let seller = request.headers.get('x-yak-app-eid') ?? ''
  let raw = request.headers.get('x-yak-command-source'), origin
  if (raw?.startsWith('{')) origin = JSON.parse(raw)
  return {
    person: request.headers.get('x-yak-person') ?? undefined,
    via: request.headers.get('x-yak-via') ?? undefined,
    seller,
    source: origin?.app ?? seller,
    authority: origin?.authority,
  }
}

export let printService = async (
  request: Request,
  ports: ServicePorts,
): Promise<Response | null> => {
  let match = new URL(request.url).pathname.match(
    /^\/service\/(prepare|quote|purchase|order_status|cancel|step|reconcile|document_file|document_status|prepare_step)$/,
  )
  if (!match) return null
  if (request.method !== 'POST') {
    return new Response('POST required', { status: 405 })
  }
  try {
    let sent: unknown
    try {
      sent = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InputError('Send a valid JSON request')
      }
      throw error
    }
    let args = object(sent)
    if (match[1] === 'reconcile') {
      if (
        request.headers.get('x-yak-role') !== 'owner' ||
        args.confirm_absent !== true
      ) {
        return new Response('Owner confirmation of provider absence required', {
          status: 403,
        })
      }
      let order = id(args.order)
      await retryAbsent(ports, order)
      await schedule(ports, order)
      return Response.json(summary(await ports.orders.read(order)))
    }
    if (match[1] === 'prepare_step') {
      if (!request.headers.get('x-yak-command-call')) {
        return new Response('Scheduled command required', { status: 403 })
      }
      return Response.json(
        await prepareStep(
          ports,
          args.document ?? request.headers.get('x-yak-command-source'),
        ),
      )
    }
    if (match[1] === 'step') {
      if (!request.headers.get('x-yak-command-call')) {
        return new Response('Scheduled command required', { status: 403 })
      }
      return Response.json(
        await step(
          ports,
          id(args.order ?? request.headers.get('x-yak-command-source')),
        ),
      )
    }
    return Response.json(
      await commands(ports)(match[1], args, caller(request)),
    )
  } catch (error) {
    if (error instanceof InputError || error instanceof DocumentInputError) {
      return Response.json({ error: { message: error.message } }, {
        status: 400,
      })
    }
    throw error
  }
}
