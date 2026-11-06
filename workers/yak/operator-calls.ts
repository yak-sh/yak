// Calls: calling the platform's number reaches the person's Operator by voice
// (T-136828, D-136811). The number is PHONE_SENDER's, so texting and calling
// share it. The provider rings the webhook its texts post to (`rang`); a
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
// for anything it does or knows; what it heard and said without asking is
// kept in that conversation too, starting no turn (operator.ts `note`).
//
// While calls are a pilot, only an owner of the platform's own space is
// answered; `CALLS = "on"` answers everyone the platform knows by number.
// A call lasts at most MINUTES, and what it costs (the line, what was heard
// and what was said) is charged to the space as it goes: what is said as it
// is said, the line and what was heard every CHARGED and as the call ends,
// so an object restarted under a call loses at most that much of its charge,
// and the stream opened again charges only its own.
import type { Frame, Line, Ring } from '@yaks/phone'
import {
  type Keyed,
  type Socket,
  type Talk as Talker,
  talk,
  type Talked,
  type Told,
  type Turns,
  turns,
} from '@yaks/speech'
import { directoryOf, META, type Space } from './directory.ts'
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
import { SPACE } from './build.ts'

/** The longest a call lasts, in minutes. */
export let MINUTES = 10

// A stream opened this long after the ring is the call's own, opened again
// when its object restarted mid-call.
let RESUMED = 15_000

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
}

let secretOf = (env: Env) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
  return env.SESSION_SECRET
}

// Whom a ring reaches: the person the platform knows by the number, in the
// space they texted in or write in, their own first, while calls are open to
// them and speech is not paused. Null hangs up on them.
let reached = async (env: Env, ring: Ring) => {
  let dir = directoryOf(env.STORE)
  let person = await dir.phoned(ring.from)
  if (!person) return null
  if (env.CALLS != 'on') {
    let meta = await dir.space(META.space)
    if (!meta || await dir.role(meta, person) != 'owner') return null
  }
  let { spaceFor } = await import('./operator-texts.ts')
  // What to call them is read beside the space, so the ring waits on neither.
  let [name, space] = await Promise.all([
    dir.nameAt(person),
    dir.texting(person).then((t) => spaceFor(env, person, t?.space)),
  ])
  if (!space || await paused(env, setupOf(space).provider)) return null
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
 * name of its `n`th turn. The provider opens the stream again when the
 * object carrying it restarts, as a deploy restarts it: that stream says it
 * is back rather than hello, and its turns are named anew.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { BACK, opening } from './operator-calls.ts'
 * let ticket = { call: 'v3:c', via: 'telnyx', at: 0, first: 'Jeff' }
 * let first = opening(ticket, 'Elihu', 1000)
 * equal(first.hello, 'Hi Jeff, Elihu here. How can I help?')
 * let again = opening(ticket, 'Elihu', 120_000)
 * equal([again.hello, again.minutes], [BACK, 8])
 * equal(again.turn(1) == first.turn(1), false)
 * ```
 */
export let opening = (
  ticket: Pick<Ticket, 'call' | 'via' | 'at' | 'first'>,
  operator: string,
  now = Date.now(),
) => ({
  hello: now - ticket.at > RESUMED ? BACK : greeting(operator, ticket.first),
  minutes: MINUTES - (now - ticket.at) / 60_000,
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
  /** the call ended */
  ended: Promise<void>
}

/** How long one of the caller's turns waited, in milliseconds from their
 * last word: for the first sound played back, and for the first of the
 * answer itself (not an acknowledgement). */
export type Timed = { first?: number; answer?: number; asked?: true }

/** What every call needs from the world around it. */
export type Around = {
  /** the provider's side of the call */
  wire: Socket
  line: Line
  /** the caller's words, given to the Operator */
  ask: (text: string) => Promise<void>
  /** what is said when the call is answered */
  hello: string
  /** what the call used since it was last charged: seconds of the line and
   * the dollars of what it heard, every CHARGED and as it ends */
  charge: (used: { seconds: number; heard: number }) => Promise<void>
  /** what the call used in all, how its turns were timed, and what ended
   * it (`stop`, `close 1000`, `error` or `us`), once it ends */
  done: (
    call: { seconds: number; heard: number; turns: Timed[]; ended: string },
  ) => Promise<void>
  hangup: () => Promise<void>
  minutes?: number
  /** how often it charges, in milliseconds: CHARGED */
  every?: number
  report?: (error: unknown) => void
}

/** A call heard and spoken around the Operator's own model. */
export type Talk = Around & {
  /** audio heard a turn at a time */
  listen: (told: Told) => Turns
  /** text spoken as raw samples in the line's format */
  say: (text: string) => Promise<ReadableStream<Uint8Array>>
  /** what is said the moment a caller's turn ends, made as the call starts */
  ack?: string
}

/** A call a model hears and speaks itself, asking the Operator. */
export type Talking = Around & {
  talk: (told: Talked) => Talker
  /** words said on the call that asked the Operator nothing, the caller's
   * or (`said`) the model's, for their conversation */
  note: (text: string, said: boolean) => void
}

// The least audio sent to the line at once: a tenth of a second at 8 kHz.
let CHUNK = 800

let GOODBYE = 'I have to go now. Call me back any time.'

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
// so a line closed cleanly ends the call quietly; one that fails, or closes
// any other way before the call ended, is a stream the call lost.
let carry = (
  o: Around,
  hear: (audio: Uint8Array) => void,
  heard: () => number,
  close: () => void,
) => {
  let report = reporter(o)
  let wire = held(o.wire)
  let started = Date.now(), over = false
  let timers: ReturnType<typeof setTimeout>[] = []
  let later = (ms: number, f: () => void) => timers.push(setTimeout(f, ms))
  let turns: Timed[] = []
  let turn: { at: number; timed: Timed } | undefined
  let finished: () => void
  let ended = new Promise<void>((resolve) => finished = resolve)
  let used = { seconds: 0, heard: 0 }
  let charge = () => {
    let last = used
    used = { seconds: (Date.now() - started) / 1000, heard: heard() }
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
  let finish = (ended = 'us') => {
    if (over) return
    over = true
    for (let t of timers) clearTimeout(t)
    close()
    try {
      wire.close(1000)
    } catch {
      // Already closed by the other side.
    }
    Promise.all([charge(), o.done({ ...used, turns, ended }).catch(report)])
      .finally(finished)
  }
  wire.addEventListener('message', (event) => {
    let frame: Frame = o.line.frame(String(event.data))
    if (frame.audio) hear(frame.audio)
    if (frame.stop) finish('stop')
  })
  wire.addEventListener('close', ({ code }) => {
    if (!over && !CLEAN.includes(code ?? 1005)) {
      report(new Error(`A call's line closed with ${code} before it ended`))
    }
    finish(`close ${code ?? 1005}`)
  })
  wire.addEventListener('error', () => {
    if (!over) report(new Error(`A call's line failed before it ended`))
    finish('error')
  })
  return {
    report,
    ended,
    finish,
    later,
    over: () => over,
    /** the caller's turn ended now */
    stopped: () => {
      turn = { at: Date.now(), timed: {} }
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
      if (!audio.length || over) return
      if (turn) {
        let ms = Date.now() - turn.at
        turn.timed.first ??= ms
        if (answer) turn.timed.answer ??= ms
      }
      wire.send(o.line.play(audio))
    },
    /** stop what is playing */
    clear: () => wire.send(o.line.clear()),
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
 * The moment a turn ends `ack` is played, from audio made as the call
 * starts; a caller who starts talking stops whatever is playing.
 */
export let converse = (o: Talk): Call => {
  let asked = false, streamed = false, buffer = '', failed = 0
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
  let ack = o.ack
    ? o.say(plain(o.ack)).then(async (body) =>
      new Uint8Array(await new Response(body).arrayBuffer())
    )
    : undefined
  ack?.catch(c.report)
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
      if (ack) queue(async () => c.play(await ack, false))
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
    ended: c.ended,
  }
}

/** The one tool a talking model has: the Operator, given what the caller
 * wants. */
export let ASK = {
  name: 'ask',
  description:
    'Ask the Operator, who has every tool, the conversation so far and the person’s apps, messages and memory. Give their request in their own words, with anything said earlier that it depends on. It answers with what to tell them.',
  parameters: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description: 'what they want, as they said it',
      },
    },
    required: ['request'],
  },
}

/** What a talking model is told: who it is, how it sounds, and that the
 * Operator, through `ask`, does the work. */
export let instructed = (name: string) =>
  `You are ${name}, a person's Operator on yaks.app, on the phone with them. Speak like a refined British butler: cool, calm, professional, and brisk: a sentence or two, each short, in plain speech. Greetings, thanks, goodbyes and small talk you answer yourself. Everything else goes to the ask tool at once, with their request in their own words: anything they want done, found, remembered or changed, and any question about their apps, messages, accounts, work, what was said before, or what you can do for them. Through it you can do anything they could ask of you in writing, so never say you cannot do something or have no tools: ask. Say only "Certainly, one moment." before it, and never speak of the tool or of anyone else doing the work. Then say what it answers, in your own voice, as briefly as it allows. Never guess what the tool would know.`

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
  // What the response under way heard and said, kept in the conversation
  // once it ends, unless it is one of the next `dropping`: one that asked
  // the Operator, whose request and answer are in the conversation already,
  // or one that says such an answer.
  let lines: { text: string; said: boolean }[] = []
  let dropping = 0
  let kept = () => {
    for (let l of lines) o.note(l.text, l.said)
    lines = []
  }
  let c = carry(
    o,
    (audio) => talker?.send(audio),
    () => talker?.spent().dollars ?? 0,
    () => {
      if (!dropping) kept()
      talker?.close()
    },
  )
  let asking = false
  talker = o.talk({
    start: () => c.clear(),
    stopped: () => c.stopped(),
    heard: (text) => void lines.push({ text, said: false }),
    said: (text) => void lines.push({ text, said: true }),
    done: () => {
      if (!dropping) return kept()
      dropping--
      lines = []
    },
    audio: (bytes) => c.play(bytes, !asking),
    call: async (name, args) => {
      if (name != ASK.name) return `There is no tool called ${name}.`
      let { request } = JSON.parse(args) as { request?: string }
      c.acked()
      asking = true
      // This response and the one that says the answer.
      dropping = 2
      let answer!: (text: string) => void
      let answered = new Promise<string>((resolve) => answer = resolve)
      pending.push(answer)
      try {
        await o.ask(String(request ?? ''))
      } catch (error) {
        pending.splice(pending.indexOf(answer), 1)
        asking = false
        c.report(error)
        return FAILED
      }
      return await answered
    },
    lost: (why) => {
      c.report(new Error(`A call's talk stream was lost: ${why}`))
      c.finish()
    },
  })
  c.limit(() => talker?.say(GOODBYE))
  talker.say(o.hello)
  return {
    typed: () => {},
    paused: () => {},
    answered: (text) => {
      let next = pending.shift()
      asking = pending.length > 0
      if (next) return next(plain(text))
      // Said as it comes, and in the conversation already.
      dropping++
      talker?.say(plain(text))
    },
    waiting: () => pending.length > 0,
    ended: c.ended,
  }
}

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
  fetch(url.replace(/^wss:/, 'https:'), {
    headers: { upgrade: 'websocket', authorization },
  }).then((res) => {
    let socket = (res as Response & { webSocket?: Upgraded }).webSocket
    if (!socket) throw new Error(`the stream answered ${res.status}`)
    socket.accept()
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
    close: (code, reason) => ws?.close(code, reason),
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  })
}

// The WebSocket pair the runtime makes, declared structurally as build.ts does.
declare let WebSocketPair: { new (): { 0: unknown; 1: Upgraded } }

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
  let setup = setupOf(space)
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
  let opens = opening(ticket, space.operator ?? 'your Operator')
  let turn = 0
  let key = keyOf(space.eid, ticket.person)
  // The caller's words, to their conversation, answered by `model`.
  let asking = (model: string) => async (text: string) => {
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
      },
      text,
      { id: requestId(space.eid, opens.turn(++turn)) },
    )
    await armed()
  }
  let around = {
    wire: pair[1],
    line,
    hello: opens.hello,
    minutes: opens.minutes,
    charge: ({ seconds, heard }: Parameters<Around['charge']>[0]) =>
      countedSpend(env, space, heard + seconds / 60 * line.perMinute, 0),
    done: ({ seconds, turns, ended }: Parameters<Around['done']>[0]) => {
      if (live.get(key) == call) live.delete(key)
      // How long each turn waited, for comparing providers and models.
      console.log(JSON.stringify({
        call: 'operator',
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
    hangup: () => caller().hangup(ticket.call),
  }
  // What a talking model said and heard on its own, kept in order.
  let noted = Promise.resolve()
  let call: Call = setup.talks
    ? talking({
      ...around,
      // Behind a talking model the Operator answers with the fastest model.
      ask: asking(CALL_MODELS[0]),
      note: (text, said) => {
        noted = noted.then(() =>
          operator.note({ person: ticket.person }, space, text, {
            call: ticket.call,
            said,
          })
        ).catch((e) => defect(e, CALL))
      },
      talk: (told) =>
        talk({
          ...speech,
          format: line.format,
          model: setup.model,
          voice: setup.voice,
          speed: setup.speed,
          instructions: instructed(space.operator ?? 'the Operator'),
          tools: [ASK],
          told,
          open: upgraded,
        }),
    })
    : converse({
      ...around,
      ask: asking(setup.model),
      listen: (told) =>
        turns({ ...speech, format: line.format, told, open: upgraded }),
      say: async (text) =>
        (await speaking(env, space, text, {
          provider: setup.provider,
          format: line.format,
          voice: setup.voice,
          speed: setup.speed,
        })).body,
      ack: 'One moment.',
    })
  live.set(key, call)
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
