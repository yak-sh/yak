import { h } from 'preact'
import { Button, Card, Notice } from '@yaks/ui/parts'
import { type Order, progress } from './fulfillment.ts'
import { query } from './orders.ts'
import { appBase } from './request.ts'
import { caller, commands } from './service.ts'
import { type Environment, runtime } from './runtime.ts'
import { note } from './site/note.ts'
import { Slip } from './site/parts.ts'

let labels: Record<string, string> = {
  payment_pending: 'Waiting for payment',
  paid: 'Payment received',
  reconciling: 'Confirming your print order',
  created: 'Checking print files',
  unpaid: 'Waiting for the printer payment',
  payment_in_progress: 'Printer payment processing',
  production_delayed: 'Paid; waiting for the production delay',
  production_ready: 'Ready for production',
  in_production: 'Printing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  rejected: 'The printer rejected the files',
  expired: 'This unpaid quote expired',
  payment_refunded: 'Payment refunded before printing',
  payment_disputed: 'Payment disputed; printing is on hold',
}
let denied = () =>
  new Response('This receipt is not available.', {
    status: 403,
    headers: { 'cache-control': 'private, no-store' },
  })

/** The buyer may manage this paid obligation at the seller even if the
 * originating app no longer holds a service connection. */
export let receiptPage = async (
  request: Request,
  env: Environment,
): Promise<Response | null> => {
  let url = new URL(request.url)
  if (url.pathname !== '/receipt') return null
  let id = url.searchParams.get('order'), who = caller(request)
  if (
    !id || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) || !who.person
  ) return denied()
  let [order] = await query<Order>(env.APP, `.entity.eid=${id}`)
  if (!order?.print_order || order.print_order.person !== who.person) {
    return denied()
  }
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== appBase(request).origin) {
      return denied()
    }
    await commands(await runtime(env, request))('cancel', { order: id }, {
      ...who,
      source: order.print_order.source,
    })
    return new Response(null, {
      status: 303,
      headers: {
        location: new URL(`receipt?order=${id}`, appBase(request)).href,
      },
    })
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405 })
  }
  let status = progress(order), preview = order.print_order.preview === true
  let links = (order.print_receipt?.tracking ?? []).filter((value) =>
    /^https?:\/\//.test(value)
  )
  let base = appBase(request).href
  let line = (name: string, value: string | number) =>
    h(Slip.Line, {}, h(Slip.Name, {}, name), h(Slip.Value, {}, value))
  let body = note(
    base,
    'Your PrintBound order',
    h(
      Card,
      {},
      h(Card.Head, {}, h(Card.Title, {}, order.print_order.print.title)),
      preview &&
        h(
          Notice,
          {},
          'Preview simulation. No payment was taken and no print order was sent.',
        ),
      h(
        Slip,
        {},
        line('Status', labels[status] ?? status.replaceAll('_', ' ')),
        line('Quantity', order.print_order.print.quantity),
        line('Document revision', order.print_order.manifest.revision),
      ),
      order.print_cancel_denied &&
        h(
          'p',
          {},
          'The printer could not cancel this order before production.',
        ),
      h(
        Card.Actions,
        {},
        links.map((href) =>
          h(Button, { href, rel: 'noreferrer' }, 'Track shipment')
        ),
        h(Button, { href: `${base}receipt?order=${id}` }, 'Refresh status'),
        !['refunded', 'cancelled', 'shipped', 'delivered', 'expired'].includes(
          status,
        ) &&
          h(
            Card.Form,
            { method: 'post' },
            h(Button, { mod: 'danger' }, 'Request cancellation'),
          ),
      ),
    ),
  )
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  })
}
