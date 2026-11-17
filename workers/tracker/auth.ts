// Tracker access is a short-lived, signed scope, not a directory lookup. Yak
// vouches for a member after its own authorization; the box holds platform scope.

import { platform } from './core.ts'

import { type Access, opened, sign } from '@yaks/tracker/ticket'
export { type Access, sign } from '@yaks/tracker/ticket'
export let authorize = async (
  request: Request,
  secret: string | undefined,
  scope: string,
  now = Date.now(),
): Promise<Access | null> => {
  let bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  // A scoped ticket also supports browser WebSocket handshakes. It expires in
  // minutes and is never returned in a report or request bundle.
  let url = new URL(request.url)
  let socket = url.pathname == '/ws' &&
    request.headers.get('upgrade')?.toLowerCase() == 'websocket'
  let token = bearer ?? (socket ? url.searchParams.get('ticket') : null)
  if (!secret || !token) return null
  let access = await opened(token, secret)
  return access && typeof access.exp == 'number' && access.exp * 1000 > now &&
      typeof access.person == 'string' && !!access.person &&
      access.scope == scope && (scope != platform || access.admin === true)
    ? access
    : null
}

/** A build's short-lived capability for this bundle's canary alone. */
export let canaryHeaders = async (
  secret: string,
  hash: string,
  now = Date.now(),
) => ({
  authorization: `Bearer ${await sign({
    scope: `canary:${hash}`,
    person: 'build',
    exp: Math.floor(now / 1000) + 60,
  }, secret)}`,
})
