// The CLI accepts browser returns only on the registered loopback address.
import { resolvers } from '@yaks/fp'

export type Listen = (
  address: { hostname: string; port: number },
  handle: (request: Request) => Response | Promise<Response>,
) => { shutdown: () => Promise<void> } | undefined

export let listen: Listen = (address, handle) => {
  if (typeof Deno == 'undefined') return undefined
  try {
    return Deno.serve({ ...address, onListen: () => {} }, handle)
  } catch (error) {
    if (
      error instanceof Deno.errors.AddrInUse ||
      error instanceof Deno.errors.AddrNotAvailable ||
      error instanceof Deno.errors.NotSupported
    ) return undefined
    throw error
  }
}

let page = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  })

export type BrowserReturn = {
  callback: string
  respond: (connected: boolean) => void
}

export let loopback = async (
  redirect: URL,
  state: string,
  bind: Listen,
  accept: (value: BrowserReturn) => void,
): Promise<(() => Promise<void>) | undefined> => {
  let reply: ((response: Response) => void) | undefined
  let closed = false
  let handle = (request: Request): Response | Promise<Response> => {
    let url = new URL(request.url)
    if (
      request.method != 'GET' || url.origin != redirect.origin ||
      url.pathname != redirect.pathname
    ) return page(404, 'This address is for the yak sign-in return.')
    if (url.searchParams.get('state') != state) {
      return page(400, 'This return does not match the current yak sign-in.')
    }
    if (closed || reply) {
      return page(409, 'Check your terminal for the yak sign-in result.')
    }
    let result = resolvers<Response>()
    reply = result.resolve
    let returned: BrowserReturn = {
      callback: url.href,
      respond: (connected) => {
        if (connected) closed = true
        reply = undefined
        result.resolve(
          connected
            ? page(200, 'Connected. You can close this tab and return to yak.')
            : page(400, 'Sign-in could not finish. Check your terminal.'),
        )
      },
    }
    // Masked input also delivers its completed line in a microtask.
    queueMicrotask(() => accept(returned))
    return result.promise
  }
  let listeners: NonNullable<ReturnType<Listen>>[] = []
  let close = async () => {
    closed = true
    reply?.(page(409, 'Check your terminal for the yak sign-in result.'))
    await Promise.all(listeners.map((server) => server.shutdown()))
  }
  try {
    for (let hostname of ['127.0.0.1', '::1']) {
      let server = bind({ hostname, port: Number(redirect.port) }, handle)
      if (server) listeners.push(server)
    }
  } catch (error) {
    // A second bind may fail after the first has succeeded.
    await close()
    throw error
  }
  if (listeners.length) return close
}
