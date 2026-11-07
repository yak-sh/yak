// Calls: calling the platform's number reaches the person's Operator by voice
// (T-136828, D-136811). The number is PHONE_SENDER's, so texting and calling
// share it; its voice connection is the Telnyx Call Control application
// "yaks.app Operator", whose webhook is `/telnyx/webhook`. The provider rings the webhook its texts post to (`rang`); a
// person the platform knows by that number is answered with the call's audio
// streamed both ways to `/<via>/stream`, which carries a sealed ticket to the
// space's Builder object, where the Operator runs (`answering`).
//
// The Operator's setup (speech.ts `setupOf`: its voice, which names the
// provider, and the model that answers) says how the call runs, the same for
// every provider. Around the Operator's own model (`converse`), the provider
// hears the caller a turn at a time, each turn goes to their one conversation
// as the `voice` channel, and what the Operator writes is spoken a sentence
// at a time as it is written (`typed`). With a model that hears and speaks
// itself (`talking`), the call's audio goes to that model, which answers
// small talk itself and asks the Operator, through the same conversation,
// for anything it does or knows. Every line said on it is kept in that
// conversation too, starting no turn (operator.ts `note`): the caller's as
// theirs, and the model's as the Operator's own words.
//
// Everyone the platform knows by number is answered. A call lasts at most MINUTES, and what it costs (the line, what was heard
// and what was said) is charged to the space as it goes: what is said as it
// is said, the line and what was heard every CHARGED and as the call ends,
// so an object restarted under a call loses at most that much of its charge,
// and the stream opened again charges only its own.
import { type Clock, system } from '@yaks/fp'
import { CallError } from '@yaks/tools'
import type { Frame, Line, Ring } from '@yaks/phone'
import {
  type Backend,
  type Keyed,
  type Provider,
  type Setup,
  type Socket,
  type Talk as Talker,
  talk,
  type Talked,
  talkerOf,
  type Told,
  type Turns,
  turns,
} from '@yaks/speech'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { bound, defect } from './defects.ts'
import { opened, seal } from './lib/token.ts'
import { apex } from './host.ts'
import { countedSpend } from './meter.ts'
import { phoneAt } from './phones.ts'
import {
  CALL_MODELS,
  passed,
  paused,
  setupOf,
  speaking,
  speechOf,
} from './speech.ts'
import type { Operator } from './operator.ts'
import { ownerOf } from './operator-access.ts'
import { receive, requestId } from './operator-channels.ts'
import { glanceOf, type Look, looks } from './operator-glance.ts'
import { SPACE } from './build.ts'

/** The longest a call lasts, in minutes. */
export let MINUTES = 10

// A stream opened this long after the ring is the call's own, opened again
// when its object restarted mid-call; a line that dropped is lost once its
// stream has not opened again for this long.
let RESUMED = 15_000

// A line back within this many milliseconds was gone too briefly for the
// caller to notice, and the call goes on without a word about it.
let NOTICED = 3000

// The calls whose line dropped in this object before they ended, and when:
// each reported as lost unless its stream opens again first.
let away = new Map<
  string,
  { at: number; cancel: () => void }
>()

// A line the provider carries streams audio all the while, silence included;
// one that sent nothing for this many milliseconds was let go without a
// close, as the socket of a stream whose request ended before it was
// answered never closes.
let QUIET = 10_000

// The call each line in this object carries, by the provider's name for the
// call: a line opened again for it ends the one it replaced.
let carried = new Map<string, () => void>()

/** How often a call charges its line and what it heard since it last did, in
 * milliseconds. */
export let CHARGED = 10_000

/** What the Operator says when a call's stream comes back mid-call. */
export let BACK = "Sorry, I lost you for a moment. I'm back."

/** What a call's ticket carries from the ring to the space's object. */
export type Ticket = {
  space: string
  person: string
  call: string
  from: string
  to: string
  via: string
  at: number
  /** the caller's first name, when the platform knows what to call them */
  first?: string
  /** the speech provider whose own line carries the call, with its id for
   * it in `call`; none for a call streamed to us */
  carried?: string
}

let secretOf = (env: Env) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
  return env.SESSION_SECRET
}

/** Whom a ring reaches: the person the platform knows by the number, in the
 * space they texted in or write in, their own first, while speech (through
 * `provider`, else the Operator's own) is not paused. Null hangs up on them. */
export let reached = async (
  env: Env,
  ring: Pick<Ring, 'from'>,
  provider?: Provider,
) => {
  let dir = directoryOf(env.STORE)
  let person = await dir.phoned(ring.from)
  if (!person) return null
  let { spaceFor } = await import('./operator-texts.ts')
  // What to call them is read beside the space, so the ring waits on neither.
  let [name, space] = await Promise.all([
    dir.nameAt(person),
    dir.texting(person).then((t) => spaceFor(env, person, t?.space)),
  ])
  if (
    !space || await paused(env, provider ?? setupOf(env, space).provider)
  ) return null
  return { person, space, first: name?.trim().split(/\s+/)[0] || undefined }
}

/**
 * What the Operator says on picking up, brisk as a personal assistant: hello,
 * by name when it knows the caller's, who is answering, and an offer to help.
 */
/// greeting('Elihu', 'Jeff') -> 'Hi Jeff, Elihu here. How can I help?'
/// greeting('Elihu') -> 'Hi, Elihu here. How can I help?'
export let greeting = (operator: string, first?: string) =>
  `Hi${first ? ` ${first}` : ''}, ${operator} here. How can I help?`

/**
 * One opening of a call's stream at `now`: what is said as it opens, the
 * minutes the call has left of the MINUTES it lasts from its ring, and the
 * name of its `n`th turn. The provider opens the stream again when its line
 * drops, as it does when a deploy restarts the object carrying it: that
 * stream says hello no more, and its turns are named anew. It says it is
 * back only when the line was gone long enough to notice, which only an
 * object that saw it drop at `dropped` knows; a restart is too brief.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { BACK, opening } from './operator-calls.ts'
 * let ticket = { call: 'v3:c', via: 'telnyx', at: 0, first: 'Jeff' }
 * let first = opening(ticket, 'Elihu', 1000)
 * equal(first.hello, 'Hi Jeff, Elihu here. How can I help?')
 * let again = opening(ticket, 'Elihu', 120_000)
 * equal([again.hello, again.minutes], ['', 8])
 * equal(again.turn(1) == first.turn(1), false)
 * equal(opening(ticket, 'Elihu', 120_000, 119_000).hello, '')
 * equal(opening(ticket, 'Elihu', 120_000, 110_000).hello, BACK)
 * ```
 */
export let opening = (
  ticket: Pick<Ticket, 'call' | 'via' | 'at' | 'first'>,
  operator: string,
  now = Date.now(),
  dropped?: number,
) => ({
  hello: now - ticket.at <= RESUMED
    ? greeting(operator, ticket.first)
    : dropped != undefined && now - dropped > NOTICED
    ? BACK
    : '',
  minutes: MINUTES - (now - ticket.at) / 60_000,
  /** whether the call begins with this stream, rather than opens again */
  began: now - ticket.at <= RESUMED,
  turn: (n: number) => `${ticket.via}:${ticket.call}:${now}:${n}`,
})

/**
 * A call rang on `via`'s webhook. One to the platform's number from someone
 * it reaches is answered with its audio streamed to `/<via>/stream`; one from
 * anybody else is rejected. A call to any other number is not the
 * Operator's, and is left to ring.
 */
export let rang = async (env: Env, via: string, ring: Ring) => {
  let phone = await phoneAt(env)
  let options = phone?.transport()
  if (options?.via != via || !phone?.caller) return
  if (!options.number || ring.to != options.number) return
  let caller = phone.caller()
  let who = await reached(env, ring)
  if (!who) return await caller.reject(ring.id)
  let ticket: Ticket = {
    space: who.space.eid,
    person: who.person,
    call: ring.id,
    from: ring.from,
    to: ring.to,
    via,
    at: Date.now(),
    first: who.first,
  }
  let sealed = await seal('call', ticket, secretOf(env))
  await caller.answer(
    ring.id,
    `wss://${apex(env)}/${via}/stream?call=${encodeURIComponent(sealed)}`,
  )
}

/**
 * `GET /<via>/stream`: the provider's WebSocket for a call it was told to
 * stream, carried to the space's object with the ticket the answer sealed.
 * The provider opens it again when the object restarts under it, as a deploy
 * restarts it, for as long as the call may last; a ticket older than that,
 * or not sealed here, opens nothing, and is reported: the provider asks for
 * a stream only on a call it was told to stream, so a refused one is a call
 * that lost its stream.
 */
export let streamDoor = async (req: Request, env: Env, now = Date.now()) => {
  if ((req.headers.get('upgrade') ?? '').toLowerCase() != 'websocket') {
    return new Response('This is a WebSocket endpoint.', { status: 426 })
  }
  let sealed = new URL(req.url).searchParams.get('call') ?? ''
  let ticket = await opened<Ticket>('call', sealed, secretOf(env))
  let refused = !ticket
    ? 'its ticket was not sealed here'
    : now - ticket.at > (MINUTES + 1) * 60_000
    ? `its ticket is ${Math.round((now - ticket.at) / 1000)} s old`
    : undefined
  if (!ticket || refused) {
    defect(new Error(`A call's stream was refused: ${refused}`), CALL)
    return new Response(null, { status: 404 })
  }
  let { builderOf } = await import('./build-door.ts')
  return builderOf(env, ticket.space)(() => {
    let out = new Request('http://builder/operator/call', req)
    for (let h of [SPACE, 'x-yak-person', 'x-yak-role', 'x-yak-call']) {
      out.headers.delete(h)
    }
    out.headers.set(SPACE, ticket.space)
    out.headers.set('x-yak-person', ticket.person)
    out.headers.set('x-yak-call', JSON.stringify(ticket))
    return out
  })
}

/** Text as it is said aloud: no Markdown, and a link named rather than
 * read out. */
export let plain = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/^\s*(#+|[-*]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// A sentence ends at its stop and the space after it; what is left waits for
// more words.
let SENTENCE = /^(.+?[.!?])(?:["')\]]*)\s+/s

/** A call in progress, as the Operator's host speaks to it. */
export type Call = {
  /** words the Operator wrote while answering this call's caller */
  typed: (text: string) => void
  /** the Operator's model stopped writing for a step, such as a tool call:
   * what it wrote is said now rather than after the step */
  paused: () => void
  /** the Operator's answer, once its turn ended */
  answered: (text: string) => void
  /** whether the caller is waiting on an answer */
  waiting: () => boolean
  /** the Operator's work for the caller moved: what the call knows of it is
   * read again */
  moved: () => void
  /** the call ended */
  ended: Promise<void>
}

/** How long one of the caller's turns waited, in milliseconds from their
 * last word: for the first sound played back, and for the first of the
 * answer itself (not an acknowledgement). */
export type Timed = { first?: number; answer?: number; asked?: true }

/** What every call needs from the world around it. */
export type Around = {
  /** the call, as the provider names it */
  call: string
  /** the phone provider's side of the call, the socket its audio streams
   * over and how it speaks; none on a call a talking model's own line
   * carries, whose audio never passes here */
  stream?: { wire: Socket; line: Line }
  /** the caller's words, given to the Operator */
  ask: (text: string) => Promise<void>
  /** what is said when the call is answered */
  hello: string
  /** what the call used since it was last charged: seconds of the line and
   * the dollars of what it heard, every CHARGED and as it ends */
  charge: (used: { seconds: number; heard: number }) => Promise<void>
  /** what the call used in all, how its turns were timed, and what ended
   * it (`stop`, `close 1000`, `error`, `quiet`, `again`, `ended` or `us`),
   * once it ends */
  done: (
    call: { seconds: number; heard: number; turns: Timed[]; ended: string },
  ) => Promise<void>
  hangup: () => Promise<void>
  minutes?: number
  /** how often it charges, in milliseconds: CHARGED */
  every?: number
  /** how long a dropped line waits for its stream to open again before the
   * call is reported lost, in milliseconds: RESUMED */
  back?: number
  /** how long a line sends nothing before the call is lost, in
   * milliseconds: QUIET */
  quiet?: number
  report?: (error: unknown) => void
  /** the clock its timers and turns run on: the runtime's */
  time?: Clock
}

/** A call heard and spoken around the Operator's own model. */
export type Talk = Around & {
  /** audio heard a turn at a time */
  listen: (told: Told) => Turns
  /** text spoken as raw samples in the line's format */
  say: (text: string) => Promise<ReadableStream<Uint8Array>>
  /** what is said, one after another, when a caller's turn has had no
   * answer for `wait` milliseconds, made as the call starts */
  ack?: string[]
  /** how long a caller waits in silence before an acknowledgement: WAIT */
  wait?: number
}

/** The Operator's own tools, as another model working for the caller calls
 * them (operator.ts `tools`). */
export type Tools = Awaited<ReturnType<Operator['tools']>>

/** A call a model hears and speaks itself, asking the Operator. */
export type Talking = Around & {
  talk: (told: Talked) => Talker
  /** its status tools beside `ask`, each answered by reading */
  looks?: Look[]
  /** the Operator's own tools, for a larger model the talking model hands
   * hard requests to on its provider's side (`BACKEND`) */
  tools?: Tools
  /** what it is told of the Operator as the call starts, and again whenever
   * the Operator's work moves, when that changed (operator-glance.ts) */
  glance?: { recent: () => Promise<string>; work: () => Promise<string> }
  /** each line said on the call, the caller's or (`said`) the model's, for
   * their conversation, settled once it is kept there */
  note: (text: string, said: boolean) => Promise<void>
}

// The least audio sent to the line at once: a tenth of a second at 8 kHz.
let CHUNK = 800

let GOODBYE = 'I have to go now. Call me back any time.'

/** What the Operator says to fill a wait the caller would notice, a
 * different line each time. */
export let ACKS = [
  'One moment.',
  'Let me see.',
  'Just a moment, please.',
  'Bear with me.',
]

// How long a talking model's call waits, once the Operator's work moved,
// before reading it again: the steps of a burst are told as one.
let GLANCED = 2000

// How long a caller hears nothing after their turn before an
// acknowledgement fills it: a quick answer comes with none.
let WAIT = 2000

let CALL = { request: 'operator call' }

// The codes a socket closes with on purpose: done, going away, or none given.
let CLEAN = [1000, 1001, 1005]

// What a caller hears when their request fails on our side, a different
// line each time it fails again, never the error's own words.
let SORRY = [
  "Hmm, I'm sorry, something went wrong on our end and I couldn't do that. It's been reported.",
  "I'm sorry, I'm still running into errors with that. Someone is looking into it.",
  'Apologies, that failed again on our side. You could try me again a little later, or send it as a text.',
]
let sorry = (n: number) => SORRY[Math.min(n, SORRY.length - 1)]

// What a talking model is given when the Operator could not be asked, for
// it to tell the caller in its own words.
let FAILED =
  'That failed because of an error on our side, which has been reported. Tell them so in a sentence of plain words, without anything technical, and do not ask them to repeat it.'

// Nothing on a call is refused to the caller: a refusal there is a write of
// ours the platform would not take, and is reported like any failure.
let reporter = (o: Around) => o.report ?? ((e: unknown) => defect(e, CALL))

// A socket's events come from the runtime after the call's request was
// answered: each listener runs, and reports, in the call's invocation.
let held = (socket: Socket): Socket => ({
  send: (data) => socket.send(data),
  close: (code, reason) => socket.close(code, reason),
  addEventListener: (type, f) => socket.addEventListener(type, bound(f, CALL)),
})

// What every call shares: the caller's audio taken off the wire (`hear`),
// audio played to them, each turn timed from their last word, the time
// limit, what it used charged as it goes (`heard` answers what hearing has
// cost so far), and the call ended once (`close`). The provider says a call
// stopped when it ends, but not that it says so before it closes the line,
// so a line closed cleanly ends the call quietly. One that fails, or closes
// any other way before the call ended, is a stream the call lost, unless the
// provider opens it again: it does when the object carrying it restarts, as
// every deploy restarts it, and the call says it is back, ending the line it
// replaced if this object still carries it. A line that goes quiet is lost
// the same way: the stream its provider opened again may have been given
// up before it was answered, whose socket never closes. A restarted
// object's wait dies with it; a stream it cannot open again is refused at
// the door, which reports it.
let carry = (
  o: Around,
  hear: (audio: Uint8Array) => void,
  heard: () => number,
  close: () => void,
) => {
  let report = reporter(o)
  let wire = o.stream && held(o.stream.wire)
  let line = o.stream?.line
  let time = o.time ?? system
  away.get(o.call)?.cancel()
  away.delete(o.call)
  if (wire) carried.get(o.call)?.()
  let lost = (error: Error) =>
    away.set(o.call, {
      at: time.now(),
      cancel: time.after(o.back ?? RESUMED, () => {
        away.delete(o.call)
        report(error)
      }),
    })
  let started = time.now(), over = false
  let timers: (() => void)[] = []
  let later = (ms: number, f: () => void) => timers.push(time.after(ms, f))
  let turns: Timed[] = []
  let turn: { at: number; timed: Timed } | undefined
  let finished: () => void
  let ended = new Promise<void>((resolve) => finished = resolve)
  let used = { seconds: 0, heard: 0 }
  let charge = () => {
    let last = used
    used = { seconds: (time.now() - started) / 1000, heard: heard() }
    return o.charge({
      seconds: used.seconds - last.seconds,
      heard: used.heard - last.heard,
    }).catch(report)
  }
  let charging = () =>
    later(o.every ?? CHARGED, () => {
      charge()
      charging()
    })
  charging()
  // A call whose line the talking model carries is hung up once this side
  // lets it go, unless it ended: the caller would be left talking to a
  // model with no Operator behind it.
  let finish = (ended = 'us') => {
    if (over) return
    over = true
    if (carried.get(o.call) == again) carried.delete(o.call)
    for (let cancel of timers) cancel()
    close()
    try {
      wire?.close(1000)
    } catch {
      // Already closed by the other side.
    }
    if (!wire && ended != 'ended') o.hangup().catch(report)
    Promise.all([charge(), o.done({ ...used, turns, ended }).catch(report)])
      .finally(finished)
  }
  let again = () => finish('again')
  let heardAt = time.now()
  let listening = (ms: number) =>
    later(ms, () => {
      let left = heardAt + (o.quiet ?? QUIET) - time.now()
      if (left > 0) return listening(left)
      lost(new Error(`A call's line went quiet before it ended`))
      finish('quiet')
    })
  if (wire) {
    carried.set(o.call, again)
    listening(o.quiet ?? QUIET)
  }
  wire?.addEventListener('message', (event) => {
    heardAt = time.now()
    let frame: Frame = line!.frame(String(event.data))
    if (frame.audio) hear(frame.audio)
    if (frame.stop) finish('stop')
  })
  wire?.addEventListener('close', ({ code }) => {
    if (!over && !CLEAN.includes(code ?? 1005)) {
      lost(new Error(`A call's line closed with ${code} before it ended`))
    }
    finish(`close ${code ?? 1005}`)
  })
  wire?.addEventListener('error', () => {
    if (!over) lost(new Error(`A call's line failed before it ended`))
    finish('error')
  })
  // The first sound of a turn's answer, timed from the caller's last word;
  // `answer` false for an acknowledgement.
  let timed = (answer: boolean) => {
    if (!turn) return
    let ms = time.now() - turn.at
    turn.timed.first ??= ms
    if (answer) turn.timed.answer ??= ms
  }
  return {
    report,
    ended,
    finish,
    later,
    over: () => over,
    /** the caller's turn ended `ago` seconds before now */
    stopped: (ago = 0) => {
      turn = { at: time.now() - ago * 1000, timed: {} }
      turns.push(turn.timed)
    },
    /** what played since the turn ended was an acknowledgement, and the
     * turn asked the Operator */
    acked: () => {
      if (!turn) return
      delete turn.timed.answer
      turn.timed.asked = true
    },
    /** audio played to the caller, the answer's unless `answer` is false */
    play: (audio: Uint8Array, answer = true) => {
      if (!audio.length || over || !wire) return
      timed(answer)
      wire.send(line!.play(audio))
    },
    /** audio began playing on a line the talking model carries */
    plays: (answer: boolean) => !over && timed(answer),
    /** stop what is playing */
    clear: () => wire?.send(line!.clear()),
    /** at the time limit, `goodbye` said and the call hung up */
    limit: (goodbye: () => void) =>
      later((o.minutes ?? MINUTES) * 60_000, () => {
        goodbye()
        later(6000, () => o.hangup().catch(report))
      }),
  }
}

/**
 * One call's conversation, heard and spoken around the Operator's own model:
 * the caller's turns given to the Operator, and what it writes spoken back a
 * sentence at a time, what it wrote before a tool said before the tool runs.
 * A turn with nothing said for `wait` is acknowledged, from audio made as
 * the call starts; a caller who starts talking stops whatever is playing.
 */
export let converse = (o: Talk): Call => {
  let asked = false, streamed = false, buffer = '', failed = 0
  // The caller's turns, and whether anything was said since the last ended.
  let turn = 0, spoke = false, acks = 0
  // Each barge-in starts a new generation; speech of an older one is dropped.
  let generation = 0
  let chain = Promise.resolve()
  let stream: Turns | undefined
  let c = carry(
    o,
    (audio) => stream?.send(audio),
    () => stream?.spent().dollars ?? 0,
    () => stream?.close(),
  )
  let queue = (play: (mine: number) => Promise<void>) => {
    let mine = generation
    chain = chain.then(() =>
      mine == generation && !c.over() ? play(mine) : undefined
    ).catch(c.report)
  }
  let speak = (text: string, answer = true) => {
    let words = plain(text)
    if (!words || c.over()) return
    spoke = true
    queue(async (mine) => {
      let reader = (await o.say(words)).getReader()
      let held = new Uint8Array(0)
      let send = () => {
        c.play(held, answer)
        held = new Uint8Array(0)
      }
      while (true) {
        let next = await reader.read()
        if (mine != generation || c.over()) {
          await reader.cancel()
          return
        }
        if (next.done) break
        let more = new Uint8Array(held.length + next.value.length)
        more.set(held)
        more.set(next.value, held.length)
        held = more
        if (held.length >= CHUNK) send()
      }
      send()
    })
  }
  let ack = (o.ack ?? []).map((text) => {
    let audio = o.say(plain(text)).then(async (body) =>
      new Uint8Array(await new Response(body).arrayBuffer())
    )
    audio.catch(c.report)
    return audio
  })
  stream = o.listen({
    start: () => {
      generation++
      c.clear()
    },
    end: (text) => {
      if (!text || c.over()) return
      c.stopped()
      asked = true
      streamed = false
      buffer = ''
      spoke = false
      let mine = ++turn
      if (ack.length) {
        c.later(o.wait ?? WAIT, () => {
          if (mine != turn || spoke || !asked) return
          let audio = ack[acks++ % ack.length]
          queue(async () => c.play(await audio, false))
        })
      }
      o.ask(text).catch((error) => {
        c.report(error)
        asked = false
        speak(sorry(failed++))
      })
    },
    lost: (why) => {
      c.report(new Error(`A call's speech stream was lost: ${why}`))
      c.finish()
    },
  })
  c.limit(() => speak(GOODBYE))
  speak(o.hello, false)
  return {
    typed: (text) => {
      if (!asked) return
      streamed = true
      buffer += text
      let m
      while ((m = SENTENCE.exec(buffer))) {
        speak(m[1])
        buffer = buffer.slice(m[0].length)
      }
    },
    paused: () => {
      if (!asked || !buffer.trim()) return
      speak(buffer)
      buffer = ''
    },
    answered: (text) => {
      if (streamed) speak(buffer)
      else speak(text)
      buffer = ''
      asked = streamed = false
    },
    waiting: () => asked,
    moved: () => {},
    ended: c.ended,
  }
}

/** The one tool a talking model has: the Operator, given what the caller
 * wants. */
export let ASK = {
  name: 'ask',
  description:
    'Ask the Operator, who has every tool, the conversation so far and the person’s apps, messages and memory, for something the person asked with content: something done, found, remembered or changed, or a question that what you were told and your status tools do not answer. Never for a filler, an acknowledgement, a laugh, a reaction or remark, half a sentence, or words that make no sense where they fall: those you answer yourself or let pass. Give their request in their own words, with anything said earlier that it depends on. It answers with what to tell them.',
  parameters: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description: 'what they asked for, as they said it',
      },
    },
    required: ['request'],
  },
}

// Who a talking model is and how it sounds, said to both kinds.
let butler = (name: string) =>
  `You are ${name}, a person's Operator on yaks.app, on the phone with them. Speak like a refined British butler: cool, calm, professional, and brisk: a sentence or two, each short, in plain speech.`

// What a turned model is told of what to answer and how it asks.
let TURNED =
  `Most of what a caller says is not a request, and you answer it yourself, never with the ask tool: greetings, thanks, goodbyes and small talk; fillers such as oh or hm; acknowledgements such as okay, yep, right, cool or got it; a laugh; and a reaction or remark such as "that's odd" or "we still have work to do". To these say a word or two, and never ask what they meant. Half a sentence they have not finished, or an um or uh with more to come, you let go on: listen, and say nothing. Words that make no sense where they fall, such as "one" or "under the sink", are the room or the line: let them pass. While you wait for an answer, an okay or a hum needs nothing from you. You are told the newest of your conversation with them and the work you have going for them, and told the work again as it moves; your status tools (work, updates, apps, conversation) look up how things stand. A question about how things stand, such as what you are working on and how far it got, whether anything needs them, which apps they have, or what was said before, you answer yourself from what you were told or a status tool, at once, as nothing more than what they say. Anything else they ask with content goes to the ask tool, at once, with their request in their own words: anything they want done, found, remembered or changed, and any question your notes and status tools do not answer. Never do anything yourself: whatever is done is done through ask. Through it you can do anything they could ask of you in writing, so never say you cannot do something or have no tools: ask. Call it without a word first when the answer should come quickly. Only when it will plainly take a while, such as building or changing something, say a few words first, never the same ones twice in a row, and never speak of the tool or of anyone else doing the work. Then say what it answers, in your own voice, as briefly as it allows. Never guess what the tool would know.`

// What a duplex model is told of when to speak and what to hand over.
let DUPLEX =
  `Backchannel policy: Seldom; a quiet "mm" at most while they explain something long.

Interruption policy: When they talk over you with words that say something, stop at once, even mid-sentence, and listen. An okay, a hum, a laugh, or a word that makes no sense where it falls, such as "one" or "under the sink", is the room or the line: go on. Half a sentence they have not finished, or an um or uh with more to come, you let go on: listen, and say nothing.

Delegation policy: Your backend is the Operator's own work, which can do anything they could ask of you in writing. Delegate at once whenever they want something done, found, remembered or changed, and for any question your notes do not answer, with no words first when the answer should come quickly. Do not delegate greetings, thanks, goodbyes and small talk; fillers such as oh or hm; acknowledgements such as okay, yep, right, cool or got it; a laugh; or a reaction or remark such as "that's odd" or "we still have work to do": to these say a word or two, and never ask what they meant. Do not delegate a question about how things stand that your notes answer, such as what you are working on and how far it got, whether anything needs them, which apps they have, or what was said before: answer it yourself, at once. You are told the newest of your conversation with them and the work you have going for them, and told the work again as it moves. Never do anything yourself, and never say you cannot do something: delegate. Never speak of the backend or of anyone else doing the work. Say what it answers in your own voice, as briefly as it allows. Never guess what it would know.`

/** What a talking model is told: who it is, how it sounds, and that the
 * Operator does the work, through `ask`, or for a `duplex` model, which has
 * no tools of its own, through the work it hands over. */
export let instructed = (name: string, duplex = false) =>
  duplex ? `${butler(name)}\n\n${DUPLEX}` : `${butler(name)} ${TURNED}`

/** What a larger model a talking model hands hard requests to on its
 * provider's side is told: that it works for the caller's Operator on a live
 * call, with the Operator's tools, and hands longer work to the Operator. */
export let backed = (name: string, now: Date) =>
  `You work for ${name}, a person's Operator on yaks.app, while it is on the phone with them: it hands you what they ask that needs thought, facts, their apps or something done. Transcripts of the call can have mistakes and unfinished phrases; use the latest of what they said, and when a detail you need is unclear, say what to ask them instead of guessing. You have the Operator's tools: use them for their apps, rows, messages, reminders and memory. Anything that takes more than a few steps, such as building or changing an app, or that needs the Operator's own conversation with them, give to the ask tool in their words, and report what it answers. It is ${now.toISOString()} now. Answer in a sentence or two of plain words with the facts and what was done, and say something was done only once a tool said so.`

/**
 * One call's conversation with a model that hears and speaks itself: the
 * caller's audio goes to it and its audio to them, and what it asks of the
 * Operator (`ASK`) goes to their one conversation, the Operator's answer
 * given back for it to say. An answer that comes with nothing asked, such as
 * a helper's outcome, it says as it comes.
 */
export let talking = (o: Talking): Call => {
  let pending: ((text: string) => void)[] = []
  let talker: Talker | undefined
  // What the response under way heard and said, kept in the conversation in
  // the order it was said: once the response ends, or before what it asks
  // the Operator, so the caller's words come before the request made of
  // them. What it says of an answer is what the caller heard of it.
  let lines: { text: string; said: boolean }[] = []
  let kept = Promise.resolve()
  let keep = () => {
    for (let l of lines.splice(0)) kept = o.note(l.text, l.said)
    return kept
  }
  let c = carry(
    o,
    (audio) => talker?.send(audio),
    () => talker?.spent().dollars ?? 0,
    () => {
      keep()
      talker?.close()
    },
  )
  let asking = false
  let looks = new Map((o.looks ?? []).map((l) => [l.name, l]))
  // What the caller asked, in their words, put to the Operator: its answer
  // comes through `answered`.
  let ask = async (request: string) => {
    c.acked()
    asking = true
    let answer!: (text: string) => void
    let answered = new Promise<string>((resolve) => answer = resolve)
    pending.push(answer)
    try {
      await keep()
      await o.ask(request)
    } catch (error) {
      pending.splice(pending.indexOf(answer), 1)
      asking = false
      c.report(error)
      return FAILED
    }
    return await answered
  }
  talker = o.talk({
    over: () => c.clear(),
    stopped: (ago) => c.stopped(ago),
    heard: (text) => void lines.push({ text, said: false }),
    said: (text) => void lines.push({ text, said: true }),
    done: () => void keep(),
    audio: (bytes) => c.play(bytes, !asking),
    plays: () => c.plays(!asking),
    ended: () => c.finish('ended'),
    call: async (name, args) => {
      let look = looks.get(name)
      if (look) {
        return await look.read().catch((error) => {
          c.report(error)
          return FAILED
        })
      }
      if (name != ASK.name) {
        if (!o.tools) return `There is no tool called ${name}.`
        return await o.tools.run(name, JSON.parse(args)).catch((error) => {
          // A tool's refusal of what it was asked is its answer.
          if (error instanceof CallError) return error.message
          c.report(error)
          return FAILED
        })
      }
      let { request } = JSON.parse(args) as { request?: string }
      return await ask(String(request ?? ''))
    },
    delegate: (request) => ask(request),
    lost: (why) => {
      c.report(new Error(`A call's talk stream was lost: ${why}`))
      c.finish()
    },
    refused: (why) =>
      c.report(
        new Error(`A call's talk model refused what it was sent: ${why}`),
      ),
  })
  c.limit(() => talker?.say(GOODBYE))
  if (o.hello) talker.say(o.hello)
  // What it knows of the Operator: the conversation and the work as the
  // call starts, then the work again a moment after it moves, when what it
  // says changed.
  let known = '', glancing = false
  let work = () =>
    o.glance!.work().then((text) => {
      let told = text != known && !c.over()
      known = text
      return told ? text : ''
    })
  let tell = (texts: Promise<string>[]) =>
    Promise.all(texts).then((told) => {
      let text = told.filter(Boolean).join('\n\n')
      if (text && !c.over()) talker?.tell(text)
    }).catch(c.report)
  if (o.glance) tell([o.glance.recent(), work()])
  let moved = () => {
    if (!o.glance || glancing || c.over()) return
    glancing = true
    c.later(GLANCED, () => {
      glancing = false
      tell([work()])
    })
  }
  return {
    typed: () => {},
    paused: () => {},
    moved,
    answered: (text) => {
      let next = pending.shift()
      asking = pending.length > 0
      if (next) return next(plain(text))
      // Said as it comes.
      talker?.say(plain(text))
    },
    waiting: () => pending.length > 0,
    ended: c.ended,
  }
}

// A tool a talking model is given.
type Tool = Setup['tools'][number]

// The calls this object carries, by space and person: one each.
let live = new Map<string, Call>()
let keyOf = (space: string, person: string) => `${space} ${person}`

/** The call a person is on with this space's Operator, if any. */
export let callOf = (space: string, person: string) =>
  live.get(keyOf(space, person))

// The call waiting on an Operator session, when the session is its person's
// conversation (not a helper's) and they are on a call waiting for it.
let waitingOn = async (
  store: Parameters<typeof ownerOf>[0],
  session: string,
) => {
  if (!live.size) return
  let [row] = await store.g.get([session])
  if (!row || row.spawned) return
  let owner = await ownerOf(store, session)
  let call = owner && callOf(owner.space, owner.person)
  return call?.waiting() ? call : undefined
}

/** Words an Operator session wrote: spoken on the call waiting on it. */
export let typed = async (
  store: Parameters<typeof ownerOf>[0],
  session: string,
  text: string,
) => (await waitingOn(store, session))?.typed(text)

/** An Operator session moved (a step landed, words were given): the call
 * its person is on, if any, reads the Operator's work again. */
export let moved = async (
  store: Parameters<typeof ownerOf>[0],
  session: string,
) => {
  if (!live.size) return
  let owner = await ownerOf(store, session)
  if (owner) callOf(owner.space, owner.person)?.moved()
}

/** An Operator session's model ended a step, such as before a tool call:
 * what it wrote is said on the call waiting on it now. */
export let stepped = async (
  store: Parameters<typeof ownerOf>[0],
  session: string,
) => (await waitingOn(store, session))?.paused()

type Upgraded = Socket & { accept: () => void }

/**
 * A client socket as Workers open one: a fetch with `Upgrade`, which also
 * carries the key as the request's Authorization rather than subprotocols.
 * What is sent before it opens waits in @yaks/speech's stream.
 */
export let upgraded = (url: string, { authorization }: Keyed): Socket => {
  let on: Record<string, ((event: { data?: unknown }) => void)[]> = {}
  let fire = (type: string, event: { data?: unknown } = {}) =>
    on[type]?.forEach((f) => f(event))
  let ws: Upgraded | undefined
  // Closed before it opened: closed as it opens.
  let closed: [number?, string?] | undefined
  fetch(url.replace(/^wss:/, 'https:'), {
    headers: { upgrade: 'websocket', authorization },
  }).then((res) => {
    let socket = (res as Response & { webSocket?: Upgraded }).webSocket
    if (!socket) throw new Error(`the stream answered ${res.status}`)
    socket.accept()
    if (closed) return socket.close(...closed)
    ws = socket
    for (let type of ['message', 'close', 'error'] as const) {
      socket.addEventListener(
        type,
        (event) => fire(type, event as { data?: unknown }),
      )
    }
    fire('open')
  }).catch(() => fire('error'))
  return held({
    send: (data) => ws?.send(data),
    close: (code, reason) =>
      ws ? ws.close(code, reason) : void (closed = [code, reason]),
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  })
}

// The WebSocket pair the runtime makes, declared structurally as build.ts does.
declare let WebSocketPair: { new (): { 0: unknown; 1: Upgraded } }

/**
 * What a call to `space`'s Operator shares however its audio travels: what
 * the caller says asked of the Operator, what it used charged at the line's
 * `perMinute`, how its turns were timed logged as it ends, and a talking
 * model's call (`talks`), its lines kept in their conversation and its tools
 * the Operator's status and `ask`. `begin` makes the call this object's.
 */
export let calling = async (
  env: Env,
  operator: Operator,
  space: Space,
  ticket: Ticket,
  armed: () => Promise<void> | undefined,
  o: {
    setup: ReturnType<typeof setupOf>
    perMinute: number
    hangup: () => Promise<void>
    /** how its audio travels, for the log */
    line: string
  },
) => {
  let { setup } = o
  let opens = opening(
    ticket,
    space.operator ?? 'your Operator',
    Date.now(),
    away.get(ticket.call)?.at,
  )
  let turn = 0
  let key = keyOf(space.eid, ticket.person)
  let call: Call | undefined
  // The caller's words, or a talking model's request made of them (`call`),
  // to their conversation, answered by `model`.
  let asking = (model: string, call?: string) => async (text: string) => {
    await receive(
      operator.store,
      {
        space: space.eid,
        person: ticket.person,
        channel: 'voice',
        address: ticket.from,
        reply_to: ticket.to,
        via: ticket.via,
        model,
        ...call ? { call } : {},
      },
      text,
      { id: requestId(space.eid, opens.turn(++turn)) },
    )
    await armed()
  }
  let around = {
    call: ticket.call,
    hello: opens.hello,
    minutes: opens.minutes,
    charge: ({ seconds, heard }: Parameters<Around['charge']>[0]) =>
      countedSpend(env, space, heard + seconds / 60 * o.perMinute, 0),
    done: ({ seconds, turns, ended }: Parameters<Around['done']>[0]) => {
      if (live.get(key) == call) live.delete(key)
      // How long each turn waited, for comparing providers, models and
      // lines.
      console.log(JSON.stringify({
        call: 'operator',
        line: o.line,
        provider: setup.provider.name,
        model: setup.model,
        voice: setup.voice,
        speed: setup.speed,
        seconds: Math.round(seconds),
        ended,
        turns,
      }))
      return Promise.resolve()
    },
    hangup: o.hangup,
  }
  // A talking model's call, line by line, kept in order: where it began,
  // then what was said on it.
  let noted = Promise.resolve()
  let note = (text: string, o: { said?: boolean; began?: boolean }) =>
    noted = noted.then(() =>
      operator.note({ person: ticket.person }, space, text, {
        call: ticket.call,
        ...o,
      })
    ).catch((e) => defect(e, CALL))
  let glance = {
    store: operator.store,
    space: space.eid,
    person: ticket.person,
    dir: directoryOf(env.STORE),
  }
  let looked = looks(glance)
  let name = space.operator ?? 'the Operator'
  let tools = [ASK, ...looked.map(({ read: _, ...tool }) => tool)]
  // A duplex model whose Operator picked a larger model on its provider's
  // side hands its work there, offered the Operator's own tools through the
  // caller's reach; where those cannot be read, the call goes on handing its
  // work to the Operator.
  let t = talkerOf(setup.provider, setup.model)
  let own = t?.duplex && t.backends.includes(setup.backend)
    ? await operator.tools({ person: ticket.person }, space).catch((e) => {
      defect(e, CALL)
      return undefined
    })
    : undefined
  let how: {
    instructions: string
    tools: Tool[]
    backend?: Backend
  } = {
    instructions: instructed(name, setup.duplex),
    tools,
    ...own
      ? {
        backend: {
          model: setup.backend,
          instructions: backed(name, new Date()),
          tools: [
            ...tools,
            ...own.tools.filter((o) => !tools.some((m) => m.name == o.name)),
          ],
        },
      }
      : {},
  }
  return {
    around,
    asking,
    begin: (made: Call) => {
      call = made
      live.set(key, made)
    },
    /** what a talking model is set up with: who it is, and its tools */
    how,
    /** a talking model's call, `talk` opening its stream */
    talks: (more: Pick<Talking, 'stream'>, talk: (told: Talked) => Talker) => {
      if (opens.began) note('', { began: true })
      return talking({
        ...around,
        ...more,
        looks: looked,
        glance: glanceOf(glance),
        // Behind a talking model the Operator answers with the fastest model.
        ask: asking(CALL_MODELS[0], ticket.call),
        note: (text, said) => note(text, { said }),
        tools: own,
        talk,
      })
    },
  }
}

/**
 * `/operator/call` in the space's object: the provider's stream accepted,
 * and the conversation run on it until the call ends.
 */
export let answering = async (
  env: Env,
  operator: Operator,
  space: Space,
  ticket: Ticket,
  armed: () => Promise<void> | undefined,
): Promise<Response> => {
  let phone = await phoneAt(env, { via: ticket.via })
  let setup = setupOf(env, space)
  let speech = speechOf(env, setup.provider)
  if (!phone?.line || !phone.caller || !speech) {
    defect(
      new Error(
        `A call's stream was refused: ${
          speech ? `no line on ${ticket.via}` : 'speech is off'
        }`,
      ),
      CALL,
    )
    return new Response(null, { status: 404 })
  }
  let line = phone.line
  let caller = phone.caller
  // The ring was let through at `ticket.at`, its speech not paused: the
  // greeting goes ahead on that while this object reads the balance itself.
  passed(ticket.at, setup.provider)
  let pair = new WebSocketPair()
  pair[1].accept()
  let c = await calling(env, operator, space, ticket, armed, {
    setup,
    perMinute: line.perMinute,
    hangup: () => caller().hangup(ticket.call),
    line: ticket.via,
  })
  let stream = { wire: pair[1], line }
  c.begin(
    setup.talks
      ? c.talks({ stream }, (told) =>
        talk({
          ...speech,
          ...c.how,
          format: line.format,
          model: setup.model,
          voice: setup.voice,
          speed: setup.speed,
          told,
          open: upgraded,
        }))
      : converse({
        ...c.around,
        stream,
        ask: c.asking(setup.model),
        listen: (told) =>
          turns({ ...speech, format: line.format, told, open: upgraded }),
        say: async (text) =>
          (await speaking(env, space, text, {
            provider: setup.provider,
            format: line.format,
            voice: setup.voice,
            speed: setup.speed,
          })).body,
        ack: ACKS,
      }),
  )
  return new Response(
    null,
    { status: 101, webSocket: pair[0] } as ResponseInit & {
      webSocket: unknown
    },
  )
}

/** The `voice` channel: an answer spoken on the call it was asked on, or,
 * when the call has ended, texted to a caller who agreed to texts and kept
 * in their conversation otherwise. */
export let voiced = async (
  env: Env,
  request: { space: string; person: string },
  text: string,
  texted: () => Promise<{ id?: string }>,
) => {
  let call = callOf(request.space, request.person)
  if (call) {
    call.answered(text)
    return {}
  }
  let agreed = await directoryOf(env.STORE).texting(request.person)
  return agreed ? await texted() : {}
}
