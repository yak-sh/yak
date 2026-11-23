// The door a number a space bought (numbers.ts) brings its texts through,
// for a provider that calls a URL with each one, as voip.ms does: the URL it
// is given, and the door that hears it. Its own module, apart from the
// number tools, so the kernel's door loads it alone.
import type { Own } from '@yaks/phone'
import { apex } from '@yaks/platform/host'
import type { Env } from './env.ts'
import { opened, seal } from './lib/token.ts'

let secretOf = (env: Env) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
  return env.SESSION_SECRET
}

/** Where a number's texts go, for a provider that sends them to a URL: its
 * phone's door with the kernel's seal on the number, then the query the
 * provider fills in. */
export let callbackOf = async (
  env: Env,
  via: string,
  own: Own,
  number: string,
) =>
  `https://${apex(env)}/${via}/${
    encodeURIComponent(await seal('held', { number }, secretOf(env)))
  }?${own.callback}`

/**
 * `GET /<via>/<ticket>`, where a number a space bought sends its texts when
 * its provider calls a URL (`callbackOf`): a text that reached the number
 * the ticket names is kept as any text to it is (operator-texts.ts
 * `arrived`). Nobody signs the call, so the ticket is what says it is ours;
 * only the provider holds it. Null for a ticket that is not one, which may
 * be a person's own number's (operator-line.ts `lineDoor`).
 */
export let heldDoor = async (
  req: Request,
  env: Env,
  via: string,
  own: Own,
): Promise<Response | null> => {
  let url = new URL(req.url)
  let ticket = decodeURIComponent(url.pathname.slice(`/${via}/`.length))
  let held = await opened<{ number?: string }>('held', ticket, secretOf(env))
  if (!held?.number) return null
  let arrival = own.called(url.searchParams)
  if (arrival && arrival.to != held.number) {
    return new Response('not this number', { status: 403 })
  }
  if (arrival) {
    let { arrived } = await import('./operator-texts.ts')
    await arrived(env, { ...arrival, via })
  }
  return new Response('ok', { headers: { 'content-type': 'text/plain' } })
}
