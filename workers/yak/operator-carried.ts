// Calls a talking model's own line carries (T-146161): beside the
// platform's number, whose calls stream their audio through us
// (operator-calls.ts), a number whose voice connection is a SIP trunk to a
// speech provider's line, so the call's audio goes to the provider's model
// and never through us. The provider rings `/<provider>/calls`
// (`carriedDoor`); a person the platform knows by the number calling is
// picked up there with their Operator's talking model, in the space's
// object, which joins the call with a stream that hears and steers it
// (`carrying`): what the caller says, what the model says, and the tools it
// asks for, the same Operator conversation a streamed call has. Anyone else
// is refused.
//
// What the phone provider bills for a minute of it is LINE. The line is set
// up by hand, once:
//
// 1. The speech provider's project gets a webhook at
//    `https://yaks.app/<provider>/calls` for its incoming-call event, its
//    signing secret the Worker secret LINES names (OPENAI_CALLS_SECRET).
// 2. The phone provider's number gets a SIP trunk connection to the
//    provider's SIP address (OpenAI's `sip:<project>@sip.api.openai.com`,
//    TLS signaling and SRTP media).
import { ours, refusal } from '@yaks/hook'
import { mobile } from '@yaks/phone'
import { accept, hangup, type Provider, reject, talk } from '@yaks/speech'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { defect } from './defects.ts'
import { phoneAt } from './phones.ts'
import { LINES, passed, setupOf, speechOf } from './speech.ts'
import type { Operator } from './operator.ts'
import {
  calling,
  callOf,
  reached,
  type Ticket,
  upgraded,
} from './operator-calls.ts'
import { SPACE } from './build.ts'

/** What a minute of a call on a provider's own line costs on the phone
 * provider's side: Telnyx's inbound toll-free minute on a SIP trunk, which
 * carries no media stream (telnyx.com/pricing/elastic-sip, 2026-11-06). */
export let LINE = 0.015

let CALL = { request: 'operator carried call' }

// The calls this object picked up, so a webhook rung again for one picks
// nothing up twice.
let joined = new Set<string>()

/** The provider named `name` whose own line carries calls, if any. */
export let carrierNamed = (name: string) =>
  [...LINES.keys()].find((p) => p.name == name && lined(p))

// The talking models of `provider`'s whose calls its own line carries.
let lined = (provider: Provider) => provider.talk?.find((t) => t.calls)

/** The number a SIP header names: `"Ana" <sip:+12695550142@host>;tag=…`. */
/// numberIn('"Ana" <sip:+12695550142@sip.telnyx.com>;tag=1') -> '+12695550142'
/// numberIn('<sip:12695550142@10.0.0.1>') -> '+12695550142'
/// numberIn('<sip:anonymous@x>') -> null
export let numberIn = (header = '') =>
  mobile(/sips?:([+\d]+)@/.exec(header)?.[1] ?? '')

/**
 * `POST /<provider>/calls`: the provider's webhook, signed as LINES says.
 * A call that rang from someone the platform reaches goes to their space's
 * object to be picked up; one from anybody else is refused. Any other event
 * is answered and left alone, as is a call the webhook rang for under
 * another of the provider's APIs.
 */
export let carriedDoor = async (
  req: Request,
  env: Env,
  provider: Provider,
): Promise<Response> => {
  if (req.method != 'POST') return new Response(null, { status: 405 })
  let line = LINES.get(provider)!
  let secret = env[line.secret]
  let speech = speechOf(env, provider)
  if (typeof secret != 'string' || !secret || !speech) {
    return new Response(null, { status: 404 })
  }
  let raw = await req.text()
  let why = await refusal(line.scheme, secret, raw, req.headers)
  if (why) {
    if (ours(why)) {
      defect(new Error(`A call's webhook was refused: ${why}`), CALL)
    }
    return new Response(null, { status: 401 })
  }
  let rang = lined(provider)!.calls!.rang(JSON.parse(raw))
  if (!rang) return new Response(null, { status: 204 })
  let from = numberIn(rang.headers.from)
  let who = from ? await reached(env, { from }, provider) : null
  let phone = await phoneAt(env)
  let platform = phone?.transport()
  if (!who || !from || !platform) {
    await reject({ ...speech, call: rang.id })
    return new Response(null, { status: 204 })
  }
  let ticket: Ticket = {
    space: who.space.eid,
    person: who.person,
    call: rang.id,
    from,
    // Answers after the call are texted from the platform's own number.
    to: platform.number ?? '',
    via: platform.via,
    at: Date.now(),
    first: who.first,
    carried: provider.name,
  }
  let { builderOf } = await import('./build-door.ts')
  return builderOf(env, ticket.space)(() =>
    new Request('http://builder/operator/carried', {
      method: 'POST',
      headers: {
        [SPACE]: ticket.space,
        'x-yak-person': ticket.person,
        'x-yak-call': JSON.stringify(ticket),
      },
    })
  )
}

/**
 * `/operator/carried` in the space's object: the call picked up with the
 * Operator's talking model, the provider's fastest where the Operator
 * answers some other way, and joined to run the conversation until it ends.
 * A call already joined here, rung again, is left as it is.
 */
export let carrying = async (
  env: Env,
  operator: Operator,
  space: Space,
  ticket: Ticket,
  armed: () => Promise<void> | undefined,
): Promise<Response> => {
  let provider = carrierNamed(ticket.carried ?? '')
  let speech = provider && speechOf(env, provider)
  if (!provider || !speech) {
    defect(new Error(`A carried call was refused: speech is off`), CALL)
    return new Response(null, { status: 404 })
  }
  if (joined.has(ticket.call)) return new Response(null, { status: 204 })
  // One call at a time with a person's Operator.
  if (callOf(space.eid, ticket.person)) {
    await reject({ ...speech, call: ticket.call })
    return new Response(null, { status: 204 })
  }
  joined.add(ticket.call)
  let setup = setupOf(env, space)
  let t = lined(provider)!
  let own = setup.provider == provider && t.models.includes(setup.model)
  let how = {
    model: own ? setup.model : t.models[0],
    voice: t.voices.some((v) => v.id == setup.voice) ? setup.voice : t.voice,
    speed: setup.speed,
  }
  passed(ticket.at, provider)
  let call = { ...speech, call: ticket.call }
  let c = calling(env, operator, space, ticket, armed, {
    setup: { ...setup, ...how, provider, talks: true, duplex: !!t.duplex },
    perMinute: LINE,
    hangup: () => hangup(call),
    line: provider.name,
  })
  try {
    await accept({ ...call, ...how, ...c.how })
  } catch (error) {
    joined.delete(ticket.call)
    throw error
  }
  let made = c.talks(
    {},
    (told) => talk({ ...call, ...how, ...c.how, told, open: upgraded }),
  )
  c.begin(made)
  made.ended.finally(() => joined.delete(ticket.call))
  return new Response(null, { status: 204 })
}
