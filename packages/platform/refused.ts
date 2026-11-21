// What an app's door says when it refuses. A refusal is read — by the page
// that catches it, and by the person's agent after that — so it answers a
// sentence beside its code (C-32574 item 2, where a club member's vote showed
// them `{"error":{"code":"not_a_writer"}}`). The code is the machine's half
// and never moves; the message is what someone is told. When signing in is
// the way through it also answers `signIn`, the address that does it and
// comes back (T-32593).

/** The sentence each refusal says to someone who has not signed in. */
export let SAYS: Record<string, string> = {
  method_not_allowed: 'that door does not answer this method',
  expected_websocket: 'the live door takes a websocket upgrade',
  // Names no doors: the app door's `api` is their one list.
  not_found: "no such door under this app's api",
  not_a_writer: 'sign in to change this app',
  not_a_reader: 'sign in to see this app',
  // Join, by somebody the app's own rows do not list.
  not_listed: 'only the people this app lists may join it',
  no_bytes: 'an upload needs a body: post the file itself',
  upload_gone: 'that upload is no longer under way — begin it again',
  too_large: 'that file is bigger than this app takes',
  unsupported_media_type: 'this app does not take that kind of file',
  no_such_file: 'no file at that address in this app',
  // What the store said no to — an unknown component, a `$was` that moved, a
  // dead entity. Its own sentence rides in `message`; this is the fallback.
  refused: 'the app store would not take that',
  // A stranger's first write, when no store of their own can be made for it:
  // too many made from one place, or the app holds all it keeps.
  // A page's word to the Operator (`./api/operator/send`) is the reader's
  // own, so it needs a reader.
  sign_in: 'sign in to send this to the Operator',
  sign_up: 'sign up to keep your own copy of this app: too many people are ' +
    'trying it right now to keep one in this browser',
}

/** The same refusals to someone who is signed in: signing in is no longer
 * the way through, so the sentence says whose it is to grant. */
export let MEMBER: Record<string, string> = {
  not_a_writer: 'you can read this app but not change it — its owner can ' +
    'make you an editor',
  not_a_reader: "this app is its owner's — they can let you in",
}

/** Signed in and refused, with an invitation they have not accepted: the
 * owner already let them in, and the one thing left is the click in the
 * letter, which no page of the app may make for them. A viewer's invitation
 * does not lift a refusal to write, so it is not mentioned there. */
export let WAITING = 'you have an invitation to this app waiting — accept ' +
  'it from the letter yaks.app sent you, then come back'

/** A refusal as its door answers it: its code, the sentence it says (its
 * code's in `SAYS` unless given), and where signing in is the way through.
 *
 * ```ts
 * import { json } from '@yaks/platform/refused'
 * import { equal } from '@yaks/testing'
 * let res = json(403, 'not_a_reader', undefined, '/sign-in')
 * equal([res.status, await res.json()], [403, {
 *   error: {
 *     code: 'not_a_reader',
 *     message: 'sign in to see this app',
 *     signIn: '/sign-in',
 *   },
 * }])
 * ```
 */
export let json = (
  status: number,
  code: string,
  says: string | undefined = SAYS[code],
  signIn?: string,
): Response =>
  Response.json(
    { error: { code, message: says ?? code, ...(signIn ? { signIn } : {}) } },
    { status },
  )
