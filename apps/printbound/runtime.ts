// The hosted shell: platform graph, private artifacts and seller payments.
// New-space previews use an explicit fixture configuration; live credentials
// and merchant activation are provisioned separately from deploying this code.
import { derivedEid } from '@yaks/graph/identity'
import { type Quote } from '@yaks/host/payments'
import { type Order } from './fulfillment.ts'
import { type Cost, lulu, type Printer, type Receipt } from './lulu.ts'
import { apply, query, repository, type Store } from './orders.ts'
import { documents } from './render.ts'
import { products } from './layout.ts'
import { advance, type Draft, start } from './document.ts'
import { type ServicePorts } from './service.ts'
import { InputError } from './refusal.ts'
import { appBase } from './request.ts'

export type Environment = {
  APP: Store
  STORE: Store
  FILES: Store
  LULU_KEY?: string
  LULU_SECRET?: string
}
type Settings = {
  print_service: {
    preview: boolean
    font?: string
    product: string
    margin: number
    contact: string
    sandbox?: boolean
  }
}
type Sale = {
  entity: { eid: string }
  order: {
    quote: string
    buyer: string
    source: string
    document: string
    revision: string
    session: string
    intent: string
    total_cents: number
    currency: string
    status: string
  }
}
let json = async <T>(
  store: Store,
  path: string,
  body?: unknown,
): Promise<T> => {
  let response = await store.fetch(
    path,
    body === undefined ? undefined : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) {
    throw new Error(
      `PrintBound platform ${path.split('?')[0]} failed (${response.status})`,
    )
  }
  return response.json()
}
let sale = async (store: Store, order: Order) => {
  let rows = await query<Sale>(
    store,
    `.order.quote=${order.print_order.quote}`,
  )
  if (rows.length > 1) {
    throw new Error('More than one platform payment names this print quote')
  }
  return rows[0]
}

/** A persistent fake printer for a new preview space, never a live account.
 * Its receipts live in the graph so restarting a preview loses no work. */
export let fixturePrinter = (store: Store, now: () => string): Printer => {
  let read = async (id: string) =>
    (await query<{ print_fixture: { receipt: Receipt } }>(
      store,
      `.entity.eid=${id}`,
    ))[0]?.print_fixture?.receipt
  return {
    quote: (print): Promise<Cost> =>
      Promise.resolve({
        currency: print.currency,
        subtotal: 700 * print.quantity + 500,
        shipping: 500,
        tax: 0,
        total: 700 * print.quantity + 500,
      }),
    find: async (reference) => {
      let receipt = await read(reference)
      return receipt ? { found: receipt } : { absent: true }
    },
    submit: async (reference) => {
      let receipt: Receipt = {
        id: reference,
        reference,
        status: 'UNPAID',
        changed: now(),
        message: 'Preview simulation',
        tracking: [],
      }
      await apply(store, [{
        entity: { eid: reference },
        print_fixture: { receipt },
      }])
      return receipt
    },
    status: async (id) => {
      let receipt = await read(id)
      if (!receipt) throw new Error('Preview printer lost its receipt')
      let states = ['UNPAID', 'PRODUCTION_DELAYED', 'IN_PRODUCTION', 'SHIPPED']
      let next = states[states.indexOf(receipt.status) + 1]
      if (!next) return receipt
      receipt = { ...receipt, status: next, changed: now() }
      await apply(store, [{ entity: { eid: id }, print_fixture: { receipt } }])
      return receipt
    },
    cancel: async (id) => {
      let receipt = await read(id)
      if (!receipt) throw new Error('Preview printer lost its receipt')
      await apply(store, [{
        entity: { eid: id },
        print_fixture: {
          receipt: { ...receipt, status: 'CANCELED', changed: now() },
        },
      }])
    },
  }
}

export let runtime = async (
  env: Environment,
  request: Request,
  call: typeof fetch = fetch,
): Promise<ServicePorts> => {
  let [configured] = await query<Settings>(env.APP, '.print_service&.limit=1')
  if (!configured) {
    throw new InputError(
      'Set up this preview with its embedded font and print service configuration first',
    )
  }
  let settings = configured.print_service, now = () => new Date().toISOString()
  if (
    !Number.isSafeInteger(settings.margin) || settings.margin < 0 ||
    !settings.contact
  ) {
    throw new Error('PrintBound has incomplete seller configuration')
  }
  let preview = settings.preview === true
  let printer = preview ? fixturePrinter(env.APP, now) : lulu({
    key: env.LULU_KEY ?? '',
    secret: env.LULU_SECRET ?? '',
    base: settings.sandbox
      ? 'https://api.sandbox.lulu.com'
      : 'https://api.lulu.com',
    fetch: call,
  })
  if (!preview && (!env.LULU_KEY || !env.LULU_SECRET)) {
    throw new InputError(
      'The print seller must connect its authorized Lulu account before taking orders',
    )
  }
  let ports: ServicePorts = {
    store: env.APP,
    orders: repository(env.APP),
    printer,
    now,
    preview,
    margin: settings.margin,
    contact: settings.contact,
    authorize: async (order) => {
      if ((order.print_order.preview === true) !== preview) {
        throw new Error(
          'A print order cannot change between preview and live fulfillment',
        )
      }
      // A paid order is the merchant's obligation even after its originating
      // connection is revoked. This receipt grants no new purchase authority.
      let [row] = await query<{ service_quote: { snapshot: string } }>(
        env.APP,
        `.entity.eid=${order.print_order.quote}`,
      )
      let quote: Quote = JSON.parse(row.service_quote.snapshot)
      if (
        !order.print_paid?.payment || order.print_paid.total !== quote.total ||
        order.print_paid.currency !== quote.currency ||
        order.print_order.person !== quote.buyer ||
        order.print_order.source !== quote.source ||
        order.print_order.manifest.revision !== quote.revision
      ) {
        throw new Error('Print fulfillment lost its paid order entitlement')
      }
      if (!preview && !order.print_submission && !order.print_receipt) {
        let current = await sale(env.APP, order)
        if (!current) {
          throw new Error('Print fulfillment lost its platform sale')
        }
        if (!['paid', 'restored'].includes(current.order.status)) {
          await ports.orders.patch(order.entity.eid, {
            print_payment_blocked: { at: now(), reason: current.order.status },
          })
          return false
        }
        if (order.print_payment_blocked) {
          await ports.orders.patch(order.entity.eid, {
            print_payment_blocked: null,
          })
        }
      }
      return true
    },
    begin: (draft) => {
      if (!settings.font && !(draft.interior && draft.cover)) {
        throw new InputError(
          'Configure the licensed embedded font before preparation',
        )
      }
      let spec = products[String(draft.product ?? settings.product)]
      if (!spec) throw new InputError('Choose a supported print product')
      return Promise.resolve(
        start(
          spec,
          {
            ...draft,
            backText: draft.back_text,
            frontBleed: draft.front_bleed,
            font: settings.font,
          } as Draft,
        ),
      )
    },
    advance: (state, who) => {
      let source: Store = {
        fetch: (path, init) => {
          let url = new URL(path, 'https://source.invalid')
          url.searchParams.set('subject', 'customer')
          if (who.person) url.searchParams.set('buyer', who.person)
          if (who.via) url.searchParams.set('via', who.via)
          return env.APP.fetch(url.pathname + url.search, init)
        },
      }
      return advance(
        state,
        documents(env.APP, source, who, state.draft.font, call),
      )
    },
    verifyPreparation: async (who) => {
      if (!who.authority) return
      let response = await env.APP.fetch('/service/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authority: who.authority }),
      })
      if (response.status === 403) {
        throw new InputError(
          'The source connection was revoked; reconnect before resuming preparation',
        )
      }
      if (!response.ok) {
        throw new Error(
          'The platform could not verify the preparation authority',
        )
      }
    },
    issue: async (quote) =>
      (await json<{ quote: Quote }>(env.APP, '/pay/quotes', quote)).quote,
    checkout: async (quote) => {
      if (preview) {
        await apply(env.APP, [{
          entity: { eid: quote.id },
          print_preview_paid: { at: now() },
        }])
        return {
          url: new URL(`receipt?order=${quote.id}&preview=1`, appBase(request))
            .href,
        }
      }
      return json(env.APP, '/pay/checkout', {
        quote: quote.id,
        success: new URL(`receipt?order=${quote.id}`, appBase(request)).href,
        cancel: new URL('studio', appBase(request)).href,
      })
    },
    payment: async (order) => {
      let [quoted] = await query<
        { service_quote: { snapshot: string }; print_preview_paid?: object }
      >(env.APP, `.entity.eid=${order.print_order.quote}`)
      let quote: Quote = JSON.parse(quoted.service_quote.snapshot)
      if (preview) {
        return quoted.print_preview_paid
          ? {
            checkout: quote.id,
            payment: quote.id,
            total: quote.total,
            currency: quote.currency,
          }
          : undefined
      }
      let paid = await sale(env.APP, order)
      if (!paid) return undefined
      let o = paid.order
      if (
        o.total_cents !== quote.total || o.currency !== quote.currency ||
        o.buyer !== quote.buyer || o.source !== quote.source ||
        o.document !== quote.document || o.revision !== quote.revision
      ) {
        throw new Error(
          'Platform payment disagrees with the immutable print quote',
        )
      }
      return {
        checkout: o.session,
        payment: o.intent,
        total: o.total_cents,
        currency: o.currency,
      }
    },
    file: async (blob) => {
      let response = await env.APP.fetch(
        `/pay/artifacts/${encodeURIComponent(blob)}`,
      )
      if (!response.ok) {
        throw new Error('The prepared document file is unavailable')
      }
      let bytes = new Uint8Array(await response.arrayBuffer()),
        chunks: string[] = []
      for (let n = 0; n < bytes.length; n += 32768) {
        chunks.push(String.fromCharCode(...bytes.subarray(n, n + 32768)))
      }
      return {
        base64: btoa(chunks.join('')),
        mime: response.headers.get('content-type') ??
          'application/octet-stream',
      }
    },
    assets: async (document) => {
      let link = async (blob: string) =>
        (await json<{ url: string }>(
          env.APP,
          `/pay/artifacts/${encodeURIComponent(blob)}/link`,
          {},
        )).url
      let [interior, cover] = await Promise.all([
        link(document.interior.blob),
        link(document.cover.blob),
      ])
      return { interior, cover }
    },
    refund: async (order) => {
      if (preview) {
        return {
          id: derivedEid(
            JSON.stringify(['printbound preview refund', order.entity.eid]),
          ),
        }
      }
      let paid = await sale(env.APP, order)
      if (!paid) throw new Error('The print refund lost its platform payment')
      if (paid.order.status === 'refunded') return { id: paid.entity.eid }
      let reference = derivedEid(
        JSON.stringify(['printbound refund', order.entity.eid]),
      )
      await json(env.APP, '/pay/refunds', {
        request: reference,
        order: paid.entity.eid,
        reason: 'Printing cancelled or rejected',
      })
      let result = await json<
        {
          completed?: object
          refund_sent?: { reference: string }
          refund_failed?: object
        }
      >(env.APP, `/pay/refunds/${reference}`)
      if (result.refund_failed) {
        throw new Error(
          'The payment provider could not complete the print refund',
        )
      }
      return result.completed && result.refund_sent
        ? { id: result.refund_sent.reference }
        : null
    },
    report: async (error, tags) => {
      let response = await env.APP.fetch('/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : '',
          tags,
          mechanism: 'catch',
        }),
      })
      if (!response.ok) {
        throw new Error(
          'The platform could not record a print provider failure',
          { cause: error },
        )
      }
    },
  }
  return ports
}
