// Text messages between a space's Operator and the people who agreed to them:
// the number a person gave and the words they agreed to, on the person in the
// directory (@yaks/phone); the provider webhook door; and the campaign's
// replies (T-134538). The Operator answers by text as one of its channels
// (operator-channels.ts).
import type { Bundle } from '@yaks/graph'
import {
  type Arrival,
  Blocked,
  consentEid,
  keyword,
  type Text,
} from '@yaks/phone'
import { mobile } from '@yaks/phone/mobile'
import { writes } from '@yaks/member'
import { type Ctx, refuse } from './tool.ts'
import type { Tool } from '@yaks/session'
import type { Env } from './env.ts'
import { directoryOf, type Space } from './directory.ts'
import { caught } from './defects.ts'
import { fault } from './unseen.ts'
import { mint } from './signin.ts'
import { meta } from './meta.ts'
import { onceLink, relink } from './link.ts'
import { apex } from './host.ts'
import { countedTexts } from './meter.ts'
import { charged, costOf } from './text-spend.ts'

/** The consent box's words, kept with each person who agreed to them. */
export let CONSENT =
  "I agree to receive texts from yaks.app: my Operator's answers when I text it, its alerts about my space (when it finishes a change, needs an answer from me, or something needs me) and reminders from apps I build. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Terms: https://yaks.app/terms Privacy: https://yaks.app/privacy"

/** The campaign's words (T-134538): the text sent when someone agrees on the
 * Operator page, and the answers to START, STOP and HELP. */
export let REPLIES = {
  welcome:
    "yaks.app: Welcome! Text your Operator here anytime. You'll get its answers and its alerts about your space; message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Terms: https://yaks.app/terms",
  start:
    "yaks.app: You're subscribed to texts with your Operator: its answers and its alerts about your space. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.",
  stop:
    'yaks.app: You are unsubscribed and will get no more texts. Reply START to subscribe again.',
  help:
    'yaks.app: Text your Operator anything here. For help, email hello@yaks.app. Msg & data rates may apply. Reply STOP to opt out.',
}

/** What the Operator's first answer to a text that signed someone up says
 * after its sign-off, so the brand (in the sign-off), STOP and HELP are in
 * the first text they get. */
export let DISCLOSURE =
  'Msg & data rates may apply. Reply STOP to opt out, HELP for help.'

/** The number a person is texted at, the words and moment they agreed, and
 * the space whose Operator texts them. */
export type Texting = {
  number: string
  consent: string
  at: string
  space?: string
}

/**
 * The directory rows that agree to texts at `number` from the Operator of
 * `space`: the person's `phone{number}` and their `sms_consent`. An empty
 * number stops texts and keeps the number.
 *
 * ```ts
 * import { equal, throws } from '@yaks/testing'
 * import { texts } from './operator-texts.ts'
 * let [phone] = texts('ana', '(269) 555-0142', true, '2026-11-04T00:00:00Z')
 * equal(phone, { entity: { eid: 'ana' }, phone: { number: '+12695550142' } })
 * throws(() => texts('ana', '555-0142', true))
 * throws(() => texts('ana', '269-555-0142', false))
 * ```
 */
export let texts = (
  person: string,
  number: string,
  agreed: boolean,
  at = new Date().toISOString(),
  space?: string,
): Bundle[] => {
  let entity = { eid: consentEid(person) }
  if (!number.trim()) return [{ entity, sms_consent: null }]
  let e164 = mobile(number)
  if (!e164) {
    throw refuse(
      'arguments',
      'Enter a US mobile number with its area code, like 269-555-0142.',
    )
  }
  if (!agreed) {
    throw refuse(
      'arguments',
      'Tick the box to agree to texts, or leave the number empty.',
    )
  }
  return [
    { entity: { eid: person }, phone: { number: e164 } },
    {
      entity,
      sms_consent: {
        person,
        consent: CONSENT,
        at,
        ...(space ? { space } : {}),
      },
    },
  ]
}

import { phoneNamed, phoneOf } from './phones.ts'

/**
 * The Operator's words to the person wearing `number`, each link to our zone
 * in them said as a one-click sign-in landing where it pointed (link.ts
 * `Once`), so someone who has only ever texted opens their Operator page, or
 * an app it built, already signed in. The links share one code, minted for
 * the number as a code the sign-in card texts would be (signin.ts `mint`):
 * single use, ten minutes long, and signing in no one but whoever wears the
 * number. Past the number's codes for the hour the words go as written, and
 * the page asks for a code as it would anyway.
 */
export let signingIn = (env: Env, number: string, text: string) => {
  let at = mobile(number), secret = env.SESSION_SECRET
  if (!at || !secret) return Promise.resolve(text)
  let code: Promise<string | null> | undefined
  return relink(text, env, async (back) => {
    let once = await (code ??= mint(meta(env), secret, at))
    return once && onceLink(secret, { email: at, code: once, back }, apex(env))
  })
}

/** Send a platform text that nothing waits on: a carrier's block is
 * expected until the campaign is approved, and anything else is reported. */
export let tell = async (env: Env, text: Text, why: string, via?: string) => {
  try {
    await (await phoneOf(env, via ? { via } : undefined)).send(text)
  } catch (error) {
    if (!(error instanceof Blocked)) caught(error, { request: why })
  }
}

// The way back to whoever sent `arrival`: from the number or the RCS agent
// it reached.
let back = (arrival: Arrival) =>
  arrival.rcs ? { agent: arrival.to } : { from: arrival.to }

// The space whose Operator a text goes to: the one they agreed on, else one
// they write in, their own first.
export let spaceFor = async (
  env: Env,
  person: string,
  agreed?: string,
) => {
  let dir = directoryOf(env.STORE)
  let chosen = agreed ? await dir.at(agreed) : null
  if (chosen && !chosen.trashed) return chosen
  let seats = (await dir.seats(person)).filter((s) =>
    writes(s.role) && !s.space.trashed
  )
  return (seats.find((s) => s.own) ?? seats[0])?.space ?? null
}

// A text's pictures, kept as an email's attachments are.
let pictures = async (env: Env, space: Space, arrival: Arrival) => {
  let { keepFile } = await import('./operator-channels.ts')
  let files = []
  for (let [i, m] of arrival.media.entries()) {
    let got = await fetch(m.url)
    if (!got.ok) throw new Error(`Text media answered ${got.status}`)
    files.push(
      await keepFile(
        env,
        space,
        `text-${i + 1}.${m.type.split('/')[1] ?? 'bin'}`,
        m.type || 'application/octet-stream',
        new Uint8Array(await got.arrayBuffer()),
      ),
    )
  }
  return files
}

// A stranger's text to the platform's number (D-136811) is the whole of
// signing up, once `TEXT_SIGNUP` is `on`: off until the toll-free
// verification covers it (T-138775), since texting outside what a number was
// verified for is what gets it suspended. So only the number the platform
// sends from (`PHONE_SENDER`) signs anyone up, not one it is retiring that
// still hears replies. The words they sent are their consent to be texted
// back, and they are a person wearing the number with their own space
// (identity.ts `textedIn`). A number that is no US mobile, an RCS sender and
// a text with no words sign nobody up.
let signedUp = async (env: Env, arrival: Arrival) => {
  let number = mobile(arrival.from)
  if (env.TEXT_SIGNUP != 'on' || arrival.rcs || !number) return null
  if (!arrival.text.trim()) return null
  if (arrival.to != await (await phoneOf(env)).from()) return null
  let { textedIn } = await import('./identity.ts')
  return (await textedIn(env, number, arrival.text.trim(), arrival.at)).person
}

/**
 * A text that arrived. One at an app's own number is that app's
 * (app-texts.ts). At the platform's: STOP takes back the sender's consent,
 * START gives it again, and both and HELP are answered in the campaign's
 * words; anything else from a person who agreed to texts is a request to
 * their space's Operator, which answers by text. A text from a number
 * nobody wears signs its sender up when that is switched on (`signedUp`),
 * and is not read otherwise.
 */
export let arrived = async (
  env: Env,
  arrival: Arrival & { via: string },
) => {
  let dir = directoryOf(env.STORE)
  let line = arrival.rcs ? null : await dir.lined(arrival.to)
  if (line) {
    let { appArrived } = await import('./app-texts.ts')
    return await appArrived(env, line, arrival)
  }
  let own = await dir.textSpace(arrival.to)
  if (own) {
    let { lineArrived } = await import('./operator-line.ts')
    let took = await lineArrived(env, [own], arrival)
    if (took?.fresh) await countedTexts(env, took.space, costOf(arrival.text))
    if (took) return
  }
  let person: string | null = await dir.phoned(arrival.from)
  let word = keyword(arrival.text)
  let as = (person: string) => ({ 'x-yak-person': person })
  let reply = (text: string) =>
    tell(
      env,
      { to: arrival.from, text, ...back(arrival) },
      `text ${word}`,
      arrival.via,
    )
  if (word == 'stop') {
    if (person) {
      await dir.apply({ entities: texts(person, '', false) }, as(person))
    }
    return reply(REPLIES.stop)
  }
  if (word == 'help') return reply(REPLIES.help)
  let texting = person ? await dir.texting(person) : null
  if (word == 'start') {
    if (person && !texting) {
      await dir.apply({
        entities: [{
          entity: { eid: consentEid(person) },
          sms_consent: { person, consent: arrival.text.trim(), at: arrival.at },
        }],
      }, as(person))
    }
    return reply(REPLIES.start)
  }
  if (!person && (person = await signedUp(env, arrival))) {
    texting = await dir.texting(person)
  }
  if (!person || !texting) return
  if (!arrival.text.trim() && !arrival.media.length) return
  let space = await spaceFor(env, person, texting.space)
  if (!space) return
  // The text that signed them up is the one their consent is in, however
  // often it is posted.
  let signup = Date.parse(texting.at) == Date.parse(arrival.at) &&
    texting.consent == arrival.text.trim()
  let { requestId } = await import('./operator-channels.ts')
  let { builderOf, SPACE } = await import('./build-door.ts')
  let files = await pictures(env, space, arrival)
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-person': person,
        [SPACE]: space.eid,
      },
      body: JSON.stringify({
        say: arrival.text,
        request: {
          channel: arrival.rcs ? 'rcs' : 'text',
          address: arrival.from,
          reply_to: arrival.to,
          via: arrival.via,
          files,
          ...(signup ? { signup: true } : {}),
        },
        options: {
          id: requestId(space.eid, `${arrival.via}:${arrival.id}`),
        },
      }),
    })
  )
  if (!response.ok) {
    throw new Error('Operator text intake failed: ' + await response.text())
  }
  // Counted once it is the Operator's, and only the first time a provider
  // posts it.
  if (response.status == 202) {
    await countedTexts(env, space, costOf(arrival.text))
  }
}

/**
 * `POST /<via>/webhook`: the event of the provider lent as `via`
 * (phones.ts), authenticated by its verification scheme. A missing or stale signature is refused quietly; one that is
 * complete and does not match, which is what a wrong key looks like, is
 * refused and reported. A text that failed to arrive is reported unless a
 * carrier blocked it, which is expected until the campaign is approved.
 */
export let textDoor = async (
  req: Request,
  env: Env,
  via: string,
): Promise<Response> => {
  if (req.method != 'POST') return new Response(null, { status: 405 })
  let said = await (await phoneNamed(env, via))?.hear(req)
  if (!said) {
    return new Response('Texts are not switched on here.', { status: 404 })
  }
  if ('refused' in said) {
    let message = said.refused
    if (said.ours) await fault(env, `POST /${via}/webhook`, new Error(message))
    return Response.json({ error: { code: 'bad_signature', message } }, {
      status: 400,
    })
  }
  let { arrival, outcome, ring } = said.heard
  if (ring) {
    let { rang } = await import('./operator-calls.ts')
    await rang(env, via, ring)
  }
  if (outcome?.failed && !outcome.failed.blocked) {
    caught(new Error(`A text did not arrive: ${outcome.failed.reason}`), {
      request: `${via} outcome`,
    })
  }
  if (arrival) await arrived(env, { ...arrival, via })
  return Response.json({})
}

/**
 * The Operator's `text_send`: a text to the person it works for, at the
 * number they agreed to on the Operator page, signed with its name. Their
 * reply comes back to the Operator of the space they agreed on.
 */
export let textSend = (env: Env, ctx: Ctx, space: Space): Tool => ({
  name: 'text_send',
  title: 'Send a text',
  step: { doing: 'Texting %{person}…', done: 'Texted %{person}' },
  description:
    'Send a text message to the person you are working for, at the mobile number they agreed to be texted at. Use it when they asked to be texted; to tell them something away from the page, use notification_send, which reaches them the way they chose. Keep it short; it is signed with your name. Their reply reaches you as a new request. Refused when they have not agreed to texts.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string', description: 'What to say.' } },
    required: ['text'],
  },
  run: async (args) => {
    let text = String(args.text ?? '').trim()
    if (!text) throw refuse('arguments', 'Say what to text.')
    let texting = await ctx.dir.texting(ctx.person)
    if (!texting) {
      throw refuse(
        'missing',
        'This person has not agreed to texts. They can on the Operator page.',
      )
    }
    try {
      let { id } = await textPerson(env, space, texting.number, text)
      return JSON.stringify({ texted: texting.number, id: id ?? null })
    } catch (error) {
      if (error instanceof Blocked) throw refuse('blocked', error.message)
      throw error
    }
  },
})

/** A text from `space`'s Operator to the person at `number`, a number they
 * agreed to: signed with its name, its links signing them in, and paid from
 * the space's budget. */
export let textPerson = async (
  env: Env,
  space: Space,
  number: string,
  text: string,
) => {
  let { textSigned } = await import('./operator-channels.ts')
  let phone = charged(env, space, await phoneOf(env, space.sender))
  return phone.send({
    to: number,
    text: `${await signingIn(env, number, text)}\n\n${textSigned(space)}`,
  })
}
