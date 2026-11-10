import { type Order, progress } from './fulfillment.ts'
import { query } from './orders.ts'
import { appBase } from './request.ts'
import { caller, commands } from './service.ts'
import { type Environment, runtime } from './runtime.ts'

let esc = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll(
    '"',
    '&quot;',
  )
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
  let body =
    `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Your PrintBound order</title>
<style>.Receipt{max-width:42rem;margin:3rem auto;padding:1.5rem;font:1rem/1.6 system-ui}.Receipt_Preview{padding:1rem;background:#fff2c2}.Receipt_Status{font-weight:600}.Receipt_Button{font:inherit;padding:.5rem 1rem}</style>
<main class="Receipt"><h1>Your PrintBound order</h1>${
      preview
        ? '<p class="Receipt_Preview">Preview simulation. No payment was taken and no print order was sent.</p>'
        : ''
    }
<h2>${esc(order.print_order.print.title)}</h2><p class="Receipt_Status">${
      esc(labels[status] ?? status.replaceAll('_', ' '))
    }</p>
<p>Quantity: ${order.print_order.print.quantity}</p><p>Document revision: ${
      esc(order.print_order.manifest.revision)
    }</p>
${
      links.map((link) =>
        `<p><a href="${esc(link)}" rel="noreferrer">Track shipment</a></p>`
      ).join('')
    }
${
      order.print_cancel_denied
        ? '<p>The printer could not cancel this order before production.</p>'
        : ''
    }
<p><a href="">Refresh status</a></p>${
      !['refunded', 'cancelled', 'shipped', 'delivered', 'expired'].includes(
          status,
        )
        ? '<form method="post"><button class="Receipt_Button">Request cancellation</button></form>'
        : ''
    }</main></html>`
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  })
}
