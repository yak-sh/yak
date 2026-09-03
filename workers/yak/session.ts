// Who is asking (D-32318 §Auth): the platform session cookie, verified with
// the shared secret (src/token.ts), joined to the person's membership in the
// space the request is for. The kernel is the one reader of the cookie —
// what serves an app gets `x-yak-person` and `x-yak-role` instead, and never
// the cookie — and the only writer of the two headers, so a client cannot
// send them: every internal request is built from scratch (app.ts).
//
// The write rule, one line: a member with role owner or editor writes; a
// viewer, a signed-in stranger, and nobody read. An app may widen or narrow
// that for its own data with `app.access` (T-32504), which `reads` and
// `writes` below answer; the app's FILES are never widened — a deploy is a
// member's, whatever the app lets its visitors save.
import { cookieValue, verify } from '../../src/token.ts'
import type { Access, Role } from './directory.ts'

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

// What an app lets someone who is not a member do with its store. Absent is
// `public` — every app born before the word keeps what it had.
export let reads = (who: Who, access: Access | null) =>
  access != 'private' || !!who.role

export let writes = (who: Who, access: Access | null) =>
  access == 'open' || mayWrite(who)

// The headers an app is handed in the cookie's place.
export let vouched = (who: Who): Record<string, string> => ({
  ...(who.person ? { 'x-yak-person': who.person } : {}),
  ...(who.role ? { 'x-yak-role': who.role } : {}),
})

// The header a WRITE adds to that vouch: what to call this person, so the
// store titles the person row it mints beside their rows (store.ts `knows`)
// and a byline resolves to `{eid, name}` (listing.ts `named`). The name is
// the one they chose, else the front of their address (directory.ts
// `nameAt`); their address stays in the directory, since an app's store
// learns a name and never an address book (T-32654).
//
// Read at the WRITE doors only — a read never mints a person, and every page
// load would otherwise pay for a name nobody wrote down — and by EVERY write
// door: the page's (apps.ts `acting`) had it while the agent's routed write
// did not, so a loan written through graph_apply left the lending store
// calling the borrower a bare uuid (C-32800 item 5).
export let titling = async (
  dir: { nameAt: (person: string) => Promise<string | null> },
  person: string | null,
): Promise<Record<string, string>> => {
  let title = person && await dir.nameAt(person)
  return title ? { 'x-yak-title': title } : {}
}
