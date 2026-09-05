// A letter that arrived (T-33687): the platform's third entry point, and the
// only one no URL names. Email Routing's catch-all on the yaks.app zone hands
// every address the specific rules did not claim to `email()` (index.ts), and
// this is what that door does with one.
//
// The whole of the routing is the LOCAL PART: `<space>.<app>@yaks.app` is that
// app's store, `<space>@yaks.app` is the space's home app (post.ts `mailedTo`,
// the same derivation an app's letters leave under). An address the app has
// LEFT still reaches it, the way its old hostname does. An address naming a
// space or an app that is not
// there is REFUSED — a bounce the sender reads — rather than accepted and
// dropped, because silence is the one answer that cannot be corrected later.
// Anything that fails on OUR side throws instead: a throw is a temporary
// failure the sending server retries, where a reject is forever.
//
// An arrival's `from` is the SENDER's, out on the web, where an app's own
// letters are stamped with the app's address (graph.ts `#posting`). The kernel
// door is what tells them apart, and it is the same door that admits the batch
// at all.
//
// What lands is a letter in the graph, in the words @yaks/mail declares for one
// (vocab.ts `mailWords`): `doc{title, body}` for the subject and the words, and
// `mail{from, to, at, message_id, verified}` for the envelope. Its attachments
// are filed the way a page's upload is (apps.ts `filed`) and hung off the
// letter with a `contains` edge, so a reader finds them from it.
//
// Two things this door is careful about, because a letter is a stranger's
// bytes:
//
//   THE SENDER IS DATA, NEVER AN ACTOR. The batch is applied at the kernel's
//   door (meta.ts `KERNEL`) with no person on it, so nothing an arrival says
//   can put words in a member's mouth. Who wrote it is `mail.from`, a column,
//   and the reader decides what that is worth — helped by `mail.verified`,
//   which is the receiving MTA's DKIM verdict. An unsigned letter is RECORDED
//   with `verified: false`, never dropped.
//
//   THE MIME IS PARSED BY A PARSER. postal-mime turns the raw RFC 5322 stream
//   into a subject, a body and attachments; @yaks/mail composes the bundles
//   around what it read and asks the graph nothing. An html-only letter is
//   read as its own text (`plain` below), so a body is words in every case and
//   markup in none.
import PostalMime, { type Email } from 'postal-mime'
import { link } from '@yaks/edge'
import type { Bundle } from '@yaks/graph'
import { type Head, inbound, verdict } from '@yaks/mail'
import { filed } from './apps.ts'
import * as dirPart from './directory.ts'
import { type App, appStore, directory, type Space } from './directory.ts'
import { bound, type Env, type Inbound } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { mailedTo, mailFrom } from './post.ts'

/** A letter refused at the door: the sender is told, and nothing is written. */
export class Refused extends Error {}

// The mailbox an address names, or a refusal saying which half is missing. A
// space that exists with no front page is a real answer — the address is
// spelled right and there is nothing behind it — so it says that, rather than
// the same sentence a typo gets.
let opened = async (
  env: Env,
  to: string,
): Promise<{ space: Space; app: App }> => {
  let box = mailedTo(to)
  if (!box) throw new Refused(`no mailbox for ${to}`)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let space = await dir.space(box.space)
  if (!space) throw new Refused(`no mailbox for ${to}`)
  // An address the app has LEFT still finds it, as its old hostname does
  // (apps.ts `served`, directory.ts `former`): a rename moves `app.slug` and
  // keeps the old name on the app's alias, so a letter to
  // `<space>.<was>@yaks.app` lands in the store a link to `/<was>/` reaches.
  // A slug that was nobody's here has no such move to follow, and is refused.
  let app = box.app
    ? await dir.app(space, box.app) ?? await dir.former(space, box.app)
    : await dir.home(space)
  if (!app) {
    throw new Refused(
      box.app ? `no mailbox for ${to}` : `${space.slug} has no front page: ` +
        `write to ${mailFrom(space.slug, '<app>')}`,
    )
  }
  return { space, app }
}

// An html-only letter, as words. Not a renderer and not a sanitizer: the
// markup is CUT, because a body is prose that a person and a search index
// both read, and nothing downstream is asked to be careful with it.
export let plain = (html: string) =>
  html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** The words the letter carried: its plain text, else its html read as text. */
export let words = (mail: Email) =>
  mail.text?.trim() || (mail.html ? plain(mail.html) : '')

// A time column takes a date-time, and a `Date:` header is RFC 5322 ("Tue, 27
// Aug 2024 08:49:44 -0700"). The parser's reading is used where it parses and
// the clock stands in where it does not, so `mail.at` is always a moment.
let when = (said: string | undefined) => {
  let at = said ? new Date(said) : null
  return at && !isNaN(at.getTime())
    ? at.toISOString()
    : new Date().toISOString()
}

// The letter's headers, with the PARSER's reading in front of the raw one: a
// subject is `=?UTF-8?B?…?=` on the wire and words only after it is decoded,
// and only the parser decoded it. Everything else is the header as it arrived
// — the DKIM verdict is read off `Authentication-Results`, which the receiving
// MTA wrote and no parser improves.
let read = (m: Inbound, mail: Email): Head => ({
  get: (name) => {
    let said: Record<string, string | undefined> = {
      subject: mail.subject,
      'message-id': mail.messageId,
      from: mail.from?.address,
    }
    return said[name.toLowerCase()] ?? m.headers.get(name)
  },
})

// A letter's attachments, filed where an app's own uploads are (apps.ts
// `filed`) and hung off the letter with a `contains` edge: the letter contains
// them, and the edge's eid is derived from that sentence, so the same letter
// filed twice states the same link once.
let carried = async (
  env: Env,
  space: Space,
  app: App,
  mail: Email,
  of: string,
) => {
  let out: Bundle[] = []
  for (let a of mail.attachments) {
    let bytes = typeof a.content == 'string'
      ? new TextEncoder().encode(a.content)
      : new Uint8Array(a.content as ArrayBuffer)
    if (!bytes.byteLength) continue
    let file = await filed(
      env,
      space,
      app,
      bytes,
      a.mimeType || 'application/octet-stream',
      a.filename ?? '',
    )
    out.push(...file.bundles, link(of, 'contains', file.use))
  }
  return out
}

/**
 * One letter, filed in the app its address named. It answers the entity the
 * letter landed as, so a caller (a test, a later effect) can read it back.
 *
 * A {@link Refused} means the address is nobody's here and the sender should be
 * told; anything else thrown is ours, and the sending server will try again.
 */
export let arrived = async (m: Inbound, env: Env): Promise<string> => {
  let { space, app } = await opened(env, m.to)
  let mail = await PostalMime.parse(m.raw)
  let head = read(m, mail)
  let signed = verdict(head)
  let eid = crypto.randomUUID()
  let letter = inbound({ from: m.from, to: m.to, headers: head }, {
    eid,
    text: words(mail),
    at: when(mail.date),
    // The MTA's verdict, recorded either way. No header at all — nobody
    // checked — leaves the column unwritten rather than claiming a `false`
    // nobody said.
    ...(signed == null ? {} : { verified: signed }),
  })
  await metaOf(appStore(env.STORE, space, app)).apply([
    ...letter,
    ...(await carried(env, space, app, mail, eid)),
  ], KERNEL)
  return eid
}
