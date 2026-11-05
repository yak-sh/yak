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
  mobile,
  type Text,
} from '@yaks/phone'
import { ours, refusal } from '@yaks/hook'
import { writes } from '@yaks/member'
import { type Ctx, refuse } from './tool.ts'
import type { Tool } from '@yaks/session'
import type { Env } from './env.ts'
import { directoryOf, type Space } from './directory.ts'
import { caught } from './defects.ts'
import { fault } from './unseen.ts'

/** The consent box's words, kept with each person who agreed to them. */
export let CONSENT =
  'I agree to receive app notifications by text from yaks.app about my site: when the operator finishes a change, needs an answer from me, or my site needs attention. About 1-10 msgs/month. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Terms: https://yaks.app/terms Privacy: https://yaks.app/privacy'

/** The campaign's words (T-134538): the text sent when someone agrees on the
 * Operator page, and the answers to START, STOP and HELP. */
export let REPLIES = {
  welcome:
    'yaks.app: Welcome! You will get texts from yaks.app about your site, about 1-10 a month. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Terms: https://yaks.app/terms',
  start:
    "yaks.app: You're subscribed to texts about your site, about 1-10 a month. Msg & data rates may apply. Reply STOP to opt out, HELP for help.",
  stop:
    'yaks.app: You are unsubscribed and will get no more texts. Reply START to subscribe again.',
  help:
    'yaks.app: Help with your site texts: email hello@yaks.app. Msg & data rates may apply. Reply STOP to opt out.',
}

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

// TODO(T-136921): a space's operator store kept the opt-in as
// `sms_consent{person, number, consent, at}` until the number moved onto the
// person. The Operator page hands those rows to the directory as it opens;
// this and the operator store's old declaration go once no store holds one.
/** A row the operator store kept, as the directory keeps it. */
export let handed = (
  kept: { person: string; number: string; consent: string; at: string },
): Bundle[] => [
  { entity: { eid: kept.person }, phone: { number: kept.number } },
  {
    entity: { eid: consentEid(kept.person) },
    sms_consent: { person: kept.person, consent: kept.consent, at: kept.at },
  },
]

export { texter } from './phone-providers.ts'
import { PROVIDERS, signingKey, texter } from './phone-providers.ts'
/** Send a platform text that nothing waits on: a carrier's block is
 * expected until the campaign is approved, and anything else is reported. */
export let tell = async (env: Env, text: Text, why: string, via?: string) => {
  try {
    await texter(env, via ? { via } : undefined).send(text)
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
let spaceFor = async (env: Env, person: string, agreed?: string) => {
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

/**
 * A text that arrived. One at an app's own number is that app's
 * (app-texts.ts). At the platform's: STOP takes back the sender's consent,
 * START gives it again, and both and HELP are answered in the campaign's
 * words; anything else from a person who agreed to texts is a request to
 * their space's Operator, which answers by text. A text from anyone else is
 * not read.
 */
export let arrived = async (env: Env, arrival: Arrival) => {
  let dir = directoryOf(env.STORE)
  let line = arrival.rcs ? null : await dir.lined(arrival.to)
  if (line) {
    let { appArrived } = await import('./app-texts.ts')
    return await appArrived(env, line, arrival)
  }
  let own = await dir.textSpace(arrival.to)
  if (own) {
    let { lineArrived } = await import('./operator-line.ts')
    if (await lineArrived(env, [own], arrival)) return
  }
  let person = await dir.phoned(arrival.from)
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
  if (!person || !texting) return
  if (!arrival.text.trim() && !arrival.media.length) return
  let space = await spaceFor(env, person, texting.space)
  if (!space) return
  let { requestId } = await import('./operator-channels.ts')
  let { builderOf, SPACE } = await import('./build.ts')
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
          ...(arrival.via ? { via: arrival.via } : {}),
          files,
        },
        options: {
          id: requestId(space.eid, `${arrival.via ?? 'telnyx'}:${arrival.id}`),
        },
      }),
    })
  )
  if (!response.ok) {
    throw new Error('Operator text intake failed: ' + await response.text())
  }
}

/**
 * `POST /<via>/webhook`: the selected provider's event, authenticated by its
 * verification scheme. A missing or stale signature is refused quietly; one that is
 * complete and does not match, which is what a wrong key looks like, is
 * refused and reported. A text that failed to arrive is reported unless a
 * carrier blocked it, which is expected until the campaign is approved.
 */
export let textDoor = async (
  req: Request,
  env: Env,
  via: string,
): Promise<Response> => {
  let transport = PROVIDERS[via]
  let key = signingKey(env, via)
  if (!key || !transport?.scheme || !transport.heard) {
    return new Response('Texts are not switched on here.', { status: 404 })
  }
  if (req.method != 'POST') return new Response(null, { status: 405 })
  let raw = await req.text()
  let no = await refusal(transport.scheme, key, raw, req.headers)
  if (no) {
    if (ours(no)) await fault(env, `POST /${via}/webhook`, new Error(no))
    return Response.json({ error: { code: 'bad_signature', message: no } }, {
      status: 400,
    })
  }
  let { arrival, outcome } = transport.heard(JSON.parse(raw))
  if (outcome?.failed && !outcome.failed.blocked) {
    caught(new Error(`A text did not arrive: ${outcome.failed.reason}`), {
      request: `${via} outcome`,
    })
  }
  if (arrival) await arrived(env, { ...arrival, via })
  return Response.json({})
}

export let telnyxDoor = (req: Request, env: Env) => textDoor(req, env, 'telnyx')

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
    'Send a text message to the person you are working for, at the mobile number they agreed to be texted at. Use it when they asked to be texted, or to tell them something they would want to know away from the page. Keep it short; it is signed with your name. Their reply reaches you as a new request. Refused when they have not agreed to texts.',
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
    let { textSigned } = await import('./operator-channels.ts')
    try {
      let { id } = await texter(env, space.sender).send({
        to: texting.number,
        text: `${text}\n\n${textSigned(space)}`,
      })
      return JSON.stringify({ texted: texting.number, id: id ?? null })
    } catch (error) {
      if (error instanceof Blocked) throw refuse('blocked', error.message)
      throw error
    }
  },
})
