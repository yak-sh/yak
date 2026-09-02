// Who is asking (D-32318 §Auth): the platform session cookie, verified with
// the shared secret (src/token.ts), joined to the person's membership in the
// space the request is for. The kernel is the one reader of the cookie —
// what serves an app gets `x-yak-person` and `x-yak-role` instead, and never
// the cookie — and the only writer of the two headers, so a client cannot
// send them: every internal request is built from scratch (app.ts).
//
// The write rule, one line: a member with role owner or editor writes; a
// viewer, a signed-in stranger, and nobody read. Reads are open, the way an
// app's page is — an app that wants private data is a later leaf's.
import { cookieValue, verify } from '../../src/token.ts'
import type { Role } from './directory.ts'

export type Who = { person: string | null; role: Role | null }

export let nobody: Who = { person: null, role: null }

export let whoIs = async (
  req: Request,
  secret: string | undefined,
  roleOf: (person: string) => Promise<Role | null>,
): Promise<Who> => {
  let token = cookieValue(req.headers.get('cookie'))
  if (!token || !secret) return nobody
  let claims = await verify(token, secret)
  if (!claims) return nobody
  return { person: claims.person, role: await roleOf(claims.person) }
}

export let mayWrite = (who: Who) => who.role == 'owner' || who.role == 'editor'

// The headers an app is handed in the cookie's place.
export let vouched = (who: Who): Record<string, string> => ({
  ...(who.person ? { 'x-yak-person': who.person } : {}),
  ...(who.role ? { 'x-yak-role': who.role } : {}),
})
