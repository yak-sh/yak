// Tracker access is a short-lived, signed scope, not a directory lookup. Yak
// vouches for a member after its own authorization; the box holds platform scope.

import { opened } from '../yak/lib/token.ts'
import { platform } from './core.ts'

import type { Access } from '@yaks/tracker/ticket'
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
  let token = bearer ?? new URL(request.url).searchParams.get('ticket')
  if (!secret || !token) return null
  let access = await opened<Access>('tracker', token, secret)
  return access && typeof access.exp == 'number' && access.exp * 1000 > now &&
      typeof access.person == 'string' && !!access.person &&
      access.scope == scope && (scope != platform || access.admin === true)
    ? access
    : null
}
