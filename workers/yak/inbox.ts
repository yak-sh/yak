// A letter that arrived (T-33687): the platform's third entry point. Two
// providers hand letters in, and each reads its own into a neutral `Incoming`
// (@yaks/host/senders) before anything here sees it. Email Routing's
// catch-all on the yaks.app zone hands every address the specific rules did
// not claim to `email()` (kernel.ts), which the arrival config.ts names reads
// (`reading`). Resend posts a signed `email.received` to `/mail/resend`
// (mail-receipts.ts), whose notice reads the letter in full, one for each
// recipient (`received`). Both are filed by `arrived`, which knows no
// provider.
//
// Where a letter lands follows the web (post.ts `mailedTo`, the same
// derivation an app's letters leave under): `<space>.<app>@yaks.app` is that
// app's store, `<space>@yaks.app` is the space's home app, an address at a
// space's hostname is the app its local part names or else the space's own
// mailbox, and every address at a hostname aimed at one app is that app.
// `signup@yaks.app` signs its sender up (`signingUp`). An address the app has
// left still reaches it, the way its old hostname does. An address naming a space or an
// app that is not there is refused (`Refused`) rather than accepted and
// dropped, because silence is the one answer that cannot be corrected later:
// Email Routing bounces it while the sender's server is still talking, and a
// letter Resend has already accepted is answered by a letter (`received`).
// Anything that fails on our side throws instead: a throw is a temporary
// failure the sending server, or Resend's webhook, retries, where a refusal
// is forever. A retried letter files once: its eid is derived from its
// Message-ID and the address it was written to.
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
//   which is the receiving server's DKIM verdict. An unsigned letter is
//   recorded with `verified: false`, never dropped. Only a letter its From
//   domain vouches for (`vouched`, the receiving server's DMARC verdict) signs
//   anybody up or asks an Operator as a member.
//
//   The provider reads the letter: its subject, body and attachments, and
//   both verdicts, which are its receiving server's and never a header the
//   sender wrote. @yaks/mail composes the bundles around what it read and
//   asks the graph nothing. An html-only letter is read as its own text
//   (`plain` below), so a body is words in every case and markup in none.
import type { Incoming } from '@yaks/host/senders'
import { link } from '@yaks/edge'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { and, eq, every, list, stringify } from '@yaks/query'
import { author, inbound, messageId } from '@yaks/mail'
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
import { signupAddress, url } from '@yaks/platform/host'
import { KERNEL, meta, metaOf } from './meta.ts'
import { mailedTo, mailFrom } from './post.ts'
import { counted } from './meter.ts'
import { ARRIVAL } from './config.ts'
import { lent } from './lent.ts'
import { copyOf } from './directory-copy.ts'
import { mail as post } from './mail.ts'

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
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  // Where the address lands follows the web (post.ts `mailedTo`, D-415): an
  // address a space or app has left still finds it, as its old hostname does
  // (apps.ts `served`, T-34658), until another place takes the name, which
  // then wins it (directory.ts `answering`, D-131924). A space or app in the
  // trash has no mailboxes at all (erase.ts, T-34431, T-34430): the address
  // is spelled right and nothing is behind it, and the sender is nobody we
  // owe the news that somebody deleted it.
  let box = await mailedTo(to, dir, env)
  if (!box) throw new Refused(`no mailbox for ${to}`)
  let { space } = box
  // The space's own mailbox, written by anyone who is not asking its
  // Operator (`operatorMail`), is its front page's: a trashed app is not the
  // front page (directory.ts `home`), so a space with none says so.
  let app = box.app ?? await dir.home(space)
  if (!app) {
    throw new Refused(
      `${space.slug} has no front page: ` +
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

/** A letter Email Routing handed `email()`, as the arrival config.ts names
 * reads it. */
export let reading = async (m: Inbound, env: Env): Promise<Incoming> => {
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
 * The same letter again answers the same entity and files nothing more.
 *
 * A {@link Refused} means the address is nobody's here and the sender should be
 * told; anything else thrown is ours, and the provider will try again.
 */
export let arrived = async (mail: Incoming, env: Env): Promise<string> => {
  let requested = await signingUp(mail, env) ?? await operatorMail(mail, env)
  if (requested) return requested
  let { space, app } = await opened(env, mail.to)
  let head = mail.headers
  let id = messageId(mail)
  let eid = id
    ? derivedEid(`mail|${mail.to.trim().toLowerCase()}|${id}`)
    : crypto.randomUUID()
  let store = appStore(env.STORE, space, app, env)
  // Filed already, even if since deleted: a retry neither repeats it nor
  // brings it back.
  let had = await metaOf(store, KERNEL).query(
    stringify(and(eq('entity.eid', list(eid)), every())),
    { trusted: true, graves: true },
  )
  if (had.length) return eid
  let letter = inbound(mail, {
    eid,
    text: words(mail),
    at: when(head.get('date') ?? undefined),
    // The receiving server's verdict, recorded either way. Where nobody
    // checked, the property is left unwritten rather than claiming a `false`
    // nobody said.
    ...(mail.verified == null ? {} : { verified: mail.verified }),
  })
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

/**
 * The letters a provider has already accepted, one for each recipient, each
 * filed by {@link arrived}. It answers the entities they landed as.
 *
 * A refusal can no longer bounce, so where none of them landed, the sender is
 * written to from the platform's address, one line for each address and why
 * nobody there took it. Only a sender whose domain vouches for the letter is,
 * and never a machine: anyone else's From is unproven, and a letter to it
 * would land on whoever was forged. An address one of several recipients
 * names that is nobody's here goes unanswered, since it is most often
 * somebody else's mailbox elsewhere.
 */
export let received = async (
  letters: Incoming[],
  env: Env,
): Promise<string[]> => {
  let filed: string[] = [], refused: string[] = []
  for (let mail of letters) {
    try {
      filed.push(await arrived(mail, env))
    } catch (e) {
      if (!(e instanceof Refused)) throw e
      console.log(`yak: mail refused for ${mail.to.split('@').pop()}`)
      refused.push(`${mail.to}: ${e.message}`)
    }
  }
  let [mail] = letters
  let from = mail && author(mail).trim().toLowerCase()
  if (filed.length || !mail?.vouched || machine(mail, from)) return filed
  await post(env)({
    to: from,
    subject: `Not delivered: ${mail.headers.get('subject') || '(no subject)'}`,
    body: `yaks.app received your letter, and nobody it was written to ` +
      `could take it.\n\n${refused.join('\n\n')}`,
  })
  return filed
}

// A letter to the sign-up address (D-136811): the whole of signing up, with
// no form, no link and no password. Its domain must vouch that the sender
// wrote it (DMARC, as for a member's letter to the Operator), and a
// machine's address signs nobody up. Then the sender is a person with their
// own space (identity.ts `joined`, the sign-up a code gives), and the letter is
// their first words to its Operator, which answers in the letter's thread.
// Someone who already has a space (identity.ts `met`) is writing to its
// Operator, not signing up. A reply to the Operator's sign-in letter
// lands here too (signin.ts `codeLetter`).
let signingUp = async (
  mail: Incoming,
  env: Env,
): Promise<string | null> => {
  if (mail.to.trim().toLowerCase() != signupAddress(env)) return null
  let from = author(mail).trim().toLowerCase()
  if (automated(from) || !mail.vouched) {
    throw new Refused(
      `yaks.app could not confirm that ${from} sent this letter, so it signed nobody up. Sign up at ${
        url(env, '/login')
      } instead.`,
    )
  }
  let { joined, met } = await import('./identity.ts')
  let back = await met(env, from)
  let { person, space } = await joined(
    env,
    from,
    mail.name?.trim(),
    `${mail.headers.get('subject') ?? ''}\n${words(mail)}`,
  )
  return await asked(
    mail,
    env,
    space,
    '/operator/receive',
    { 'x-yak-person': person },
    { verified: true },
    back ? {} : { signup: true },
  )
}

// App addresses keep receiving app mail. A member writing the space itself
// asks its operator, and so does a reply to a letter the Operator wrote for
// one; other arrivals remain ordinary app mail.
let operatorMail = async (
  mail: Incoming,
  env: Env,
): Promise<string | null> => {
  let dir = directoryOf(env.STORE)
  let box = await mailedTo(mail.to, dir, env)
  if (!box || box.app) return null
  let { space } = box
  let from = author(mail).trim().toLowerCase()
  let person = await dir.personAt(from)
  if (!person || !writes(await dir.role(space, person))) {
    return await replied(mail, env, space, from)
  }
  if (!mail.vouched) {
    throw new Refused(
      'The operator needs an authenticated email from your member address. Sign in and use Operator chat, or resend with DMARC authentication.',
    )
  }
  return await asked(mail, env, space, '/operator/receive', {
    'x-yak-person': person,
  }, { verified: true })
}

// Whether a machine wrote the letter (an auto-responder, a bounce), which
// nothing answers: answering it could answer forever.
let machine = (m: Incoming, from: string) =>
  automated(from) ||
  !/^(no)?$/i.test((m.headers.get('auto-submitted') ?? '').trim())

// The Message-IDs a letter answers, its In-Reply-To first and then its
// References, newest first.
let threadOf = (m: Incoming) =>
  [
    ...(m.headers.get('in-reply-to') ?? '').split(/\s+/),
    ...(m.headers.get('references') ?? '').split(/\s+/).reverse(),
  ].map((id) => id.replace(/[<>]/g, '').trim()).filter(Boolean)

// A reply to a letter the Operator wrote for a person (operator-channels.ts
// `mailSend`), from whoever it went to: the kernel brings it to the writer's
// own conversation, as the platform's person at their address, with only
// their permissions, and the person it was written for is told
// (operator-host.ts `operatorReply`). A machine's reply (an auto-responder, a
// bounce) is only told: answering it could answer forever.
let replied = async (
  m: Incoming,
  env: Env,
  space: Space,
  from: string,
): Promise<string | null> => {
  let thread = threadOf(m)
  if (!thread.length) return null
  let { builderOf, SPACE } = await import('./build-door.ts')
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
  let bot = machine(m, from)
  let { personOf } = await import('./signin.ts')
  return await asked(
    m,
    env,
    space,
    '/operator/replied',
    {
      'x-yak-kernel': '1',
      ...bot ? {} : { 'x-yak-person': await personOf(meta(env), from) },
    },
    { reply: letter },
    { address: from, thread },
  )
}

// A letter for the Operator, its attachments kept, handed to the space's
// builder object at `path` as the request it answers on.
let asked = async (
  mail: Incoming,
  env: Env,
  space: Space,
  path: string,
  who: Record<string, string>,
  arrival: { verified?: boolean; reply?: string },
  extra: { address?: string; thread?: string[]; signup?: boolean } = {},
): Promise<string> => {
  let { keepFile, requestId } = await import('./operator-channels.ts')
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
  let id = requestId(space.eid, messageId(mail))
  let signed = arrival.verified ?? mail.verified
  let received = inbound(mail, {
    eid: id,
    text: words(mail),
    ...(arrival.reply ? { reply: arrival.reply } : {}),
    ...(signed == null ? {} : { verified: signed }),
  })[0]
  let { builderOf, SPACE } = await import('./build-door.ts')
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
          address: extra.address ?? author(mail).trim().toLowerCase(),
          reply_to: messageId(mail),
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
