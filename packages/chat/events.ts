/** The HTTP intake for a chat provider. @module */
import { refusal } from '@yaks/hook'
import type { Hook, Said } from './mod.ts'

/**
 * Verify the original bytes before decoding, then deliver through the host.
 * Acknowledge a message after intake so the provider can retry a failed write.
 */
export let receive = async (
  req: Request,
  hook: Hook,
  secret: string,
  arrived: (account: string, said: Said) => Promise<void>,
): Promise<Response> => {
  if (req.method != 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } })
  }
  let raw = await req.text()
  if (await refusal(hook.scheme, secret, raw, req.headers)) {
    return new Response(null, { status: 401 })
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  let event = hook.event(body)
  if (event && 'challenge' in event) {
    return new Response(event.challenge, {
      headers: { 'content-type': 'text/plain' },
    })
  }
  if (event) await arrived(event.account, event.said)
  return new Response(null, { status: 200 })
}
