// Where a SQLite Durable Object's storage is, and putting it back there:
// Cloudflare's point-in-time recovery (T-34507), as every object that can be
// put back answers it at its kernel-only `/restore` — an app's store
// (graph.ts) and a space's Operator (build.ts). recover.ts holds the order a
// restore is asked in; this is the object's half, and the same for each.
//
// A GET reads bookmarks and changes nothing: `from` is where the object
// stands right now — which is the way back from any restore, and therefore
// the thing the caller writes down before asking for one — and `to`, when a
// moment was named, is the bookmark for that moment.
//
// A POST restores: `onNextSessionRestoreBookmark` is written down by the
// runtime, so the recovery happens whenever the object next starts, and the
// POST answers the way back. It restarts nothing, because `abort` fails every
// in-flight request, and an answer still on its way to the caller is one of
// them. The restart is a request of its own, `/restart`, which the caller
// sends once it holds that answer and whose reset is its success (recover.ts
// `putBack`).
import { refuse } from '@yaks/api/refuse'
import { Refused } from '@yaks/graph/errors'
import { caught } from './defects.ts'

/** The storage methods recovery is made of, each optional because a back
 * end may offer none of them. */
export type Bookmarked = {
  getCurrentBookmark?: () => Promise<string>
  getBookmarkForTime?: (at: Date) => Promise<string>
  onNextSessionRestoreBookmark?: (bookmark: string) => Promise<string>
}

/** What `/restart` resets the object with: the reason the runtime logs. */
export let RESTORING = 'restarting to wake at a restored bookmark'

// What a back end with no point-in-time recovery says. Local workerd offers
// `getCurrentBookmark` and refuses the other two in very nearly these words, so
// one sentence covers both the method that is missing and the method that
// throws — and a person is told the truth about their data either way.
let NO_PITR =
  "this store's back end does not offer point-in-time recovery — it is a " +
  'Cloudflare production Durable Object that does, and local development does ' +
  'not'

// What Cloudflare's "This database has no history." means for a moment asked
// of `getBookmarkForTime`: nothing had been written to the store by then.
let UNWRITTEN = (at: string) =>
  `nothing had been written to this store by ${at} (Cloudflare: "This ` +
  'database has no history."), so there is no earlier state to put it back ' +
  'to; a moment after its first write can be restored'

/**
 * The answer at `/restore`. `before` runs ahead of a POST's restore (an app's
 * store forgets its lexicon there), and `store` names the object to the
 * tracker when something other than a refusal goes wrong.
 */
export let bookmarks = async (
  s: Bookmarked,
  request: Request,
  store: string,
  before?: () => Promise<void>,
): Promise<Response> => {
  try {
    if (request.method != 'POST') {
      if (!s.getCurrentBookmark) throw new Refused(NO_PITR)
      let from = await s.getCurrentBookmark()
      let at = new URL(request.url).searchParams.get('at')
      if (!at) return Response.json({ from, to: '' })
      if (!s.getBookmarkForTime) throw new Refused(NO_PITR)
      // A moment before the store's first write is the caller asking for
      // nothing to go back to, not a failure.
      let to = await s.getBookmarkForTime(new Date(at)).catch((e) => {
        if (e instanceof Error && /has no history/.test(e.message)) {
          throw new Refused(UNWRITTEN(at))
        }
        throw e
      })
      return Response.json({ from, to })
    }
    let said = JSON.parse(await request.text()) as { bookmark?: string }
    if (!said?.bookmark) throw new Refused('/restore takes a bookmark')
    if (!s.onNextSessionRestoreBookmark) throw new Refused(NO_PITR)
    await before?.()
    let undo = await s.onNextSessionRestoreBookmark(said.bookmark)
    return Response.json({ undo })
  } catch (e) {
    // A runtime that offers none of this throws its own sentence, which is
    // handed on as a refusal rather than a 500: nothing broke, the back end
    // simply cannot do it. Where it can, a throw is ours, and the tracker hears.
    if (!(e instanceof Refused)) caught(e, { request: 'restore', store })
    return refuse(e instanceof Refused ? e : new Refused(String(e)))
  }
}
