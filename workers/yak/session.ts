// Who is asking (D-32318 §Auth): the platform session cookie, verified with
// the shared secret (src/token.ts), joined to the person's membership in the
// space the request is for. The kernel is the one reader of the cookie —
// what serves an app gets the VOUCH instead, and never the cookie — and the
// only writer of it, so a client cannot send one: every request to a store is
// built from scratch by `storeOf` (door.ts), which strips the set before it
// stamps its own.
//
// THE RULE IS NOT KEPT HERE. `member`, `grant` and `access` are @yaks/member's
// components, and the two questions they answer — may this level read a thing
// in this mode (`reads`), may it write one (`edits`, or `writes` for a level
// alone) — are that package's own words, asked at each door with `who.role` and
// the app's `access` in hand. The kernel's `Role` IS member's `Level` and its
// `Access` IS member's `Mode`, so a door and the graph that enforces it
// (graph.ts `authenticating`, @yaks/member's precondition guard) read the same
// predicate off the same words, with nothing in between to drift.
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

// The headers an app is handed in the cookie's place.
export let vouched = (who: Who): Record<string, string> => ({
  ...(who.person ? { 'x-yak-person': who.person } : {}),
  ...(who.role ? { 'x-yak-role': who.role } : {}),
})

// The header a WRITE adds to that vouch: what to call this person, so the
// store titles the person row it mints beside their rows (graph.ts `#vouching`)
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
