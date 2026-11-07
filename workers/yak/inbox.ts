import { copyOf } from './directory-copy.ts'
// A letter that arrived (T-33687): the platform's third entry point, and the
// only one no URL names. Email Routing's catch-all on the yaks.app zone hands
// every address the specific rules did not claim to `email()` (index.ts), and
// this is what that door does with one.
//
// The whole of the routing is the local part: `<space>.<app>@yaks.app` is that
// app's store, `<space>@yaks.app` is the space's home app (post.ts `mailedTo`,
// the same derivation an app's letters leave under), and `signup@yaks.app`
// signs its sender up (`signingUp`). An address the app has left still
// reaches it, the way its old hostname does. An address naming a space or an
// app that is not there is refused — a bounce the sender reads — rather than
// accepted and dropped, because silence is the one answer that cannot be
// corrected later.
// Anything that fails on our side throws instead: a throw is a temporary
// failure the sending server retries, where a reject is forever.
//
// An arrival's `from` is the sender's, out on the web, where an app's own
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
//   The sender is data, never an actor. The batch is applied at the kernel's
//   door (meta.ts `KERNEL`) with no person on it, so nothing an arrival says
//   can put words in a member's mouth. Who wrote it is `mail.from`, a property,
//   and the reader decides what that is worth — helped by `mail.verified`,
//   which is the receiving MTA's DKIM verdict. An unsigned letter is recorded
//   with `verified: false`, never dropped.
//
//   The MIME is parsed by A parser: the arrival the mail provider config.ts
//   names lends (`ARRIVAL`) turns the raw RFC 5322 stream into a subject, a
//   body and attachments; @yaks/mail composes the bundles around what it
//   read and asks the graph nothing. An html-only letter is
//   read as its own text (`plain` below), so a body is words in every case and
//   markup in none.
import type { Incoming } from '@yaks/host/senders'
import { link } from '@yaks/edge'
import type { Bundle } from '@yaks/graph'
import { author, inbound, messageId, verdict } from '@yaks/mail'
import { automated } from '@yaks/mail/answers'
import { writes } from '@yaks/member'
import { acceptsOf, filed, Untaken } from './uploads.ts'
import * as dirPart from './directory.ts'
import {
  type App,
  appStore,
  directory,
  directoryOf,
  type Space,
} from './directory.ts'
import { bound, type Env, type Inbound } from './env.ts'
import { signupAddress, url } from './host.ts'
import { KERNEL, metaOf } from './meta.ts'
import { mailedTo, mailFrom } from './post.ts'
import { counted } from './meter.ts'
import { ARRIVAL } from './config.ts'
import { lent } from './lent.ts'

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
  let box = mailedTo(to, env)
  if (!box) throw new Refused(`no mailbox for ${to}`)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  // A subdomain the space has left still finds it, as its old hostname does
  // (apps.ts `served`, T-34658): a rename moves `space.slug` and keeps the old
  // one in the space's `former`, so a letter to `<was>.<app>@yaks.app` lands
  // where a link to `<was>.yaks.app/<app>/` lands — until another space takes
  // the name, which then wins it (directory.ts `answering`, D-131924).
  let space = await dir.answering(box.space)
  // A space in the trash has no mailboxes at all (erase.ts, T-34431), for the
  // reason a trashed app has none: the address is spelled right and nothing
  // is behind it, and the sender is nobody we owe the news that somebody
  // deleted their space. Refused before the app is looked for, so a letter to
  // any address under it bounces the same way.
  if (!space || space.trashed) throw new Refused(`no mailbox for ${to}`)
  // An address the app has left still finds it, as its old hostname does
  // (apps.ts `served`, directory.ts `former`): a rename moves `app.slug` and
  // keeps the old name in the app's `former`, so a letter to
  // `<space>.<was>@yaks.app` lands in the store a link to `/<was>/` reaches.
  // A slug that was nobody's here has no such move to follow, and is refused.
  let app = box.app
    ? await dir.answeringApp(space, box.app)
    : await dir.home(space)
  // An app in the trash has no mailbox (erase.ts, T-34430): a letter to it
  // bounces the way a letter to a slug nobody ever took does, and for the
  // same reason — silence is the one answer that cannot be corrected later,
  // and the sender is nobody we owe the news that an app was deleted. The
  // home address needs no test of its own: a trashed app is not the front
  // page (directory.ts `home`), so `<space>@yaks.app` is a space with none.
  if (app?.trashed) throw new Refused(`no mailbox for ${to}`)
  if (!app) {
    throw new Refused(
      box.app ? `no mailbox for ${to}` : `${space.slug} has no front page: ` +
        `write to ${mailFrom(space.slug, '<app>', env)}`,
    )
  }
  return { space, app }
}

// An html-only letter, as words. Not a renderer and not a sanitizer: the
// markup is cut, because a body is prose that a person and a search index
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

// The letter as its provider's arrival reads it, read once: its raw stream
// can be read only once, and a letter may be asked for its sender's name
// before it is handed on whole.
let parsings = new WeakMap<Inbound, Promise<Incoming>>()
let parsed = (m: Inbound, env: Env) => {
  let mail = parsings.get(m) ?? reading(m, env)
  parsings.set(m, mail)
  return mail
}
let reading = async (m: Inbound, env: Env) => {
  let read = (await lent(env, 'arrivals'))[ARRIVAL]
  if (!read) throw new Error(`no arrival called ${ARRIVAL} reads a letter`)
  return read(m)
}

/** The words the letter carried: its plain text, else its html read as text. */
export let words = (mail: { text?: string; html?: string }) =>
  mail.text?.trim() || (mail.html ? plain(mail.html) : '')

// A time property takes a date-time, and a `Date:` header is RFC 5322 ("Tue, 27
// Aug 2024 08:49:44 -0700"). The parser's reading is used where it parses and
// the clock stands in where it does not, so `mail.at` is always a moment.
let when = (said: string | undefined) => {
  let at = said ? new Date(said) : null
  return at && !isNaN(at.getTime())
    ? at.toISOString()
    : new Date().toISOString()
}

// A letter's attachments, filed where an app's own uploads are (apps.ts
// `filed`), as far as the app takes them (`"blob"` in its vocab.json), and
// hung off the letter with a `contains` edge: the letter contains them, and
// the edge's eid is derived from that sentence, so the same letter filed
// twice states the same link once.
let carried = async (
  env: Env,
  space: Space,
  app: App,
  graph: ReturnType<typeof metaOf>,
  mail: Incoming,
  of: string,
) => {
  let out: Bundle[] = []
  let accepts = mail.attachments.length
    ? await acceptsOf(env, space, app)
    : undefined
  for (let a of mail.attachments) {
    let bytes = a.bytes
    if (!bytes.byteLength) continue
    // An attachment the app does not take is left off; the letter still lands.
    let file = await filed(
      env,
      space,
      app,
      graph,
      bytes,
      a.type || 'application/octet-stream',
      a.name,
      accepts,
    ).catch((e) => {
      if (e instanceof Untaken) return null
      throw e
    })
    if (file) out.push(...file.bundles, link(of, 'contains', file.use))
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
  let requested = await signingUp(m, env) ?? await operatorMail(m, env)
  if (requested) return requested
  let { space, app } = await opened(env, m.to)
  let mail = await parsed(m, env)
  let head = mail.headers
  let signed = verdict(head)
  let eid = crypto.randomUUID()
  let letter = inbound({ from: m.from, to: m.to, headers: head }, {
    eid,
    text: words(mail),
    at: when(head.get('date') ?? undefined),
    // The MTA's verdict, recorded either way. No header at all — nobody
    // checked — leaves the property unwritten rather than claiming a `false`
    // nobody said.
    ...(signed == null ? {} : { verified: signed }),
  })
  let store = appStore(env.STORE, space, app, env)
  let graph = metaOf(store, {
    'x-yak-person': app.eid,
    'x-yak-role': 'editor',
  })
  await metaOf(store).apply([
    ...letter,
    ...(await carried(env, space, app, graph, mail, eid)),
  ], KERNEL)
  // The month's letters, one higher (meter.ts). After the letter is filed and
  // never before it: the count is what the space received, and a meter that
  // ran ahead of the graph would bill for words nobody can read. Over the
  // allowance it still lands — the ceiling is the send door's (`metering`),
  // because a letter refused here is somebody else's words lost.
  await counted(env, space)
  return eid
}

// A letter to the sign-up address (D-136811): the whole of signing up, with
// no form, no link and no password. Its domain must vouch that the sender
// wrote it (DMARC, as for a member's letter to the Operator), and a
// machine's address signs nobody up. Then the sender is a person with their
// own space (identity.ts `joined`, the sign-up a code gives), and the letter is
// their first words to its Operator, which answers in the letter's thread.
// Someone who already has a space is writing to its Operator. A reply to the
// Operator's sign-in letter lands here too (signin.ts `codeLetter`).
let signingUp = async (m: Inbound, env: Env): Promise<string | null> => {
  if (m.to.trim().toLowerCase() != signupAddress(env)) return null
  let from = author(m).trim().toLowerCase()
  let { authenticated } = await import('./operator-channels.ts')
  if (
    automated(from) ||
    !authenticated(m.headers.get('authentication-results'), from)
  ) {
    throw new Refused(
      `yaks.app could not confirm that ${from} sent this letter, so it signed nobody up. Sign up at ${
        url(env, '/login')
      } instead.`,
    )
  }
  let { joined } = await import('./identity.ts')
  let mail = await parsed(m, env)
  let { person, space } = await joined(
    env,
    from,
    mail.name?.trim(),
    `${mail.headers.get('subject') ?? ''}\n${words(mail)}`,
  )
  return await asked(
    m,
    env,
    space,
    '/operator/receive',
    { 'x-yak-person': person },
    { verified: true },
    { signup: true },
  )
}

// App addresses keep receiving app mail. A member writing the space itself
// asks its operator, and so does a reply to a letter the Operator wrote for
// one; other arrivals remain ordinary app mail.
let operatorMail = async (m: Inbound, env: Env): Promise<string | null> => {
  let box = mailedTo(m.to, env)
  if (!box || box.app) return null
  let dir = directoryOf(env.STORE)
  let space = await dir.answering(box.space)
  if (!space || space.trashed) return null
  let from = author(m).trim().toLowerCase()
  let person = await dir.personAt(from)
  if (!person || !writes(await dir.role(space, person))) {
    return await replied(m, env, space, from)
  }
  let { authenticated } = await import('./operator-channels.ts')
  if (!authenticated(m.headers.get('authentication-results'), from)) {
    throw new Refused(
      'The operator needs an authenticated email from your member address. Sign in and use Operator chat, or resend with DMARC authentication.',
    )
  }
  return await asked(m, env, space, '/operator/receive', {
    'x-yak-person': person,
  }, { verified: true })
}

// The Message-IDs a letter answers, its In-Reply-To first and then its
// References, newest first.
let threadOf = (m: Inbound) =>
  [
    ...(m.headers.get('in-reply-to') ?? '').split(/\s+/),
    ...(m.headers.get('references') ?? '').split(/\s+/).reverse(),
  ].map((id) => id.replace(/[<>]/g, '').trim()).filter(Boolean)

// A reply to a letter the Operator wrote for a person (operator-channels.ts
// `mailSend`), from whoever it went to: the kernel brings it to that person's
// conversation, as the writer's words (operator-host.ts `operatorReply`).
let replied = async (
  m: Inbound,
  env: Env,
  space: Space,
  from: string,
): Promise<string | null> => {
  let thread = threadOf(m)
  if (!thread.length) return null
  let { builderOf, SPACE } = await import('./build.ts')
  let found = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/letter', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space.eid,
      },
      body: JSON.stringify({ thread }),
    })
  )
  if (found.status == 404) return null
  if (!found.ok) {
    throw new Error('Operator letter lookup failed: ' + await found.text())
  }
  let { letter } = await found.json() as { letter: string }
  return await asked(
    m,
    env,
    space,
    '/operator/replied',
    {
      'x-yak-kernel': '1',
    },
    { reply: letter },
    { address: from, thread },
  )
}

// A letter for the Operator, its attachments kept, handed to the space's
// builder object at `path` as the request it answers on.
let asked = async (
  m: Inbound,
  env: Env,
  space: Space,
  path: string,
  who: Record<string, string>,
  arrival: { verified?: boolean; reply?: string },
  extra: { address?: string; thread?: string[]; signup?: boolean } = {},
): Promise<string> => {
  let { keepFile, requestId } = await import('./operator-channels.ts')
  let mail = await parsed(m, env)
  let head = mail.headers
  let files = []
  for (let a of mail.attachments) {
    let bytes = a.bytes
    files.push(
      await keepFile(
        env,
        space,
        a.name || 'attachment',
        a.type || 'application/octet-stream',
        bytes,
      ),
    )
  }
  let id = requestId(space.eid, messageId({ ...m, headers: head }))
  let signed = arrival.verified ?? verdict(head)
  let received = inbound({ ...m, headers: head }, {
    eid: id,
    text: words(mail),
    ...(arrival.reply ? { reply: arrival.reply } : {}),
    ...(signed == null ? {} : { verified: signed }),
  })[0]
  let { builderOf, SPACE } = await import('./build.ts')
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder' + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...who,
        [SPACE]: space.eid,
      },
      body: JSON.stringify({
        say: words(mail),
        request: {
          channel: 'email',
          address: extra.address ?? author(m).trim().toLowerCase(),
          reply_to: messageId({ ...m, headers: head }),
          files,
          ...(extra.signup ? { signup: true } : {}),
        },
        options: { id, mail: received.mail, title: head.get('subject') ?? '' },
        in_reply_to: head.get('in-reply-to') ?? undefined,
        ...(extra.thread ? { thread: extra.thread } : {}),
      }),
    })
  )
  if (!response.ok) {
    throw new Error('Operator email intake failed: ' + await response.text())
  }
  if (response.status == 202) await counted(env, space)
  return id
}
