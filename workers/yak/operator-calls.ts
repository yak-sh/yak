// Calls: calling the platform's number reaches the person's Operator by voice
// (T-136828, D-136811). The number is PHONE_SENDER's, so texting and calling
// share it. The provider rings the webhook its texts post to (`rang`); a
// person the platform knows by that number is answered with the call's audio
// streamed both ways to `/<via>/stream`, which carries a sealed ticket to the
// space's Builder object, where the Operator runs (`answering`). There their
// words are heard a turn at a time (speech.ts, Deepgram's Flux) and given to
// their one conversation as the `voice` channel, and what the Operator writes
// is spoken a sentence at a time as it is written (`typed`), so the first
// words of a reply are heard while the rest is still being written.
//
// While calls are a pilot, only an owner of the platform's own space is
// answered; `CALLS = "on"` answers everyone the platform knows by number.
// A call lasts at most MINUTES, and what it costs (the line, what was heard
// and what was said) is charged to the space.
import type { Frame, Line, Ring } from '@yaks/phone'
import { type Socket, type Told, type Turns, turns } from '@yaks/speech'
import { directoryOf, META, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { caught } from './defects.ts'
import { opened, seal } from './lib/token.ts'
import { apex } from './host.ts'
import { countedSpend } from './meter.ts'
import { PROVIDERS, settings } from './phone-providers.ts'
import { operatorVoice, paused, speaking, speechOf } from './speech.ts'
import type { Operator } from './operator.ts'
import { ownerOf } from './operator-access.ts'
import { receive, requestId } from './operator-channels.ts'
import { SPACE } from './build.ts'

/** The longest a call lasts, in minutes. */
export let MINUTES = 10

/** What a call's ticket carries from the ring to the space's object. */
export type Ticket = {
  space: string
  person: string
  call: string
  from: string
  to: string
  via: string
  at: number
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
  if (await paused(env)) return null
  let { spaceFor } = await import('./operator-texts.ts')
  let space = await spaceFor(env, person, (await dir.texting(person))?.space)
  return space ? { person, space } : null
}

/**
 * A call rang on `via`'s webhook. One to the platform's number from someone
 * it reaches is answered with its audio streamed to `/<via>/stream`; one from
 * anybody else is rejected. A call to any other number is not the
 * Operator's, and is left to ring.
 */
export let rang = async (env: Env, via: string, ring: Ring) => {
  let options = settings(env)
  let provider = PROVIDERS[via]
  if (options.via != via || !provider?.caller) return
  if (!options.number || ring.to != options.number) return
  let caller = provider.caller(options)
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
 * A ticket more than a minute old, or not sealed here, opens nothing.
 */
export let streamDoor = async (req: Request, env: Env, now = Date.now()) => {
  if ((req.headers.get('upgrade') ?? '').toLowerCase() != 'websocket') {
    return new Response('This is a WebSocket endpoint.', { status: 426 })
  }
  let sealed = new URL(req.url).searchParams.get('call') ?? ''
  let ticket = await opened<Ticket>('call', sealed, secretOf(env))
  if (!ticket || now - ticket.at > 60_000) {
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
  /** the Operator's answer, once its turn ended */
  answered: (text: string) => void
  /** whether the caller is waiting on an answer */
  waiting: () => boolean
  /** the call ended */
  ended: Promise<void>
}

/** What a conversation needs from the world around it. */
export type Talk = {
  /** the provider's side of the call */
  wire: Socket
  line: Line
  /** audio heard a turn at a time */
  listen: (told: Told) => Turns
  /** text spoken as raw samples in the line's format */
  say: (text: string) => Promise<ReadableStream<Uint8Array>>
  /** the caller's words, given to the Operator */
  ask: (text: string) => Promise<void>
  /** what is said when the call is answered */
  hello: string
  /** what the call cost to hear and carry, once it ends */
  done: (cost: { seconds: number; heard: number }) => Promise<void>
  hangup: () => Promise<void>
  /** how long silence after a question lasts before "One moment." */
  patience?: number
  minutes?: number
  report?: (error: unknown) => void
}

// The least audio sent to the line at once: a tenth of a second at 8 kHz.
let CHUNK = 800

/**
 * One call's conversation: the caller's turns given to the Operator, and
 * what it writes spoken back a sentence at a time. A caller who starts
 * talking stops whatever is playing; an answer slow to start is covered with
 * "One moment."
 */
export let converse = (o: Talk): Call => {
  let report = o.report ?? ((e) => caught(e, { request: 'operator call' }))
  let started = Date.now()
  let over = false, asked = false, streamed = false, buffer = ''
  // Each barge-in starts a new generation; speech of an older one is dropped.
  let generation = 0
  let chain = Promise.resolve()
  let spokenSince = 0
  let timers: ReturnType<typeof setTimeout>[] = []
  let speak = (text: string) => {
    let words = plain(text)
    if (!words || over) return
    spokenSince++
    let mine = generation
    chain = chain.then(async () => {
      if (mine != generation || over) return
      let reader = (await o.say(words)).getReader()
      let held = new Uint8Array(0)
      let send = () => {
        if (held.length) o.wire.send(o.line.play(held))
        held = new Uint8Array(0)
      }
      while (true) {
        let next = await reader.read()
        if (mine != generation || over) {
          await reader.cancel()
          return
        }
        if (next.done) break
        let value = next.value
        let more = new Uint8Array(held.length + value.length)
        more.set(held)
        more.set(value, held.length)
        held = more
        if (held.length >= CHUNK) send()
      }
      send()
    }).catch(report)
  }
  let finished: () => void
  let ended = new Promise<void>((resolve) => finished = resolve)
  let stream = o.listen({
    start: () => {
      generation++
      o.wire.send(o.line.clear())
    },
    end: (text) => {
      if (!text || over) return
      asked = true
      streamed = false
      buffer = ''
      let before = spokenSince
      timers.push(setTimeout(() => {
        if (asked && spokenSince == before) speak('One moment.')
      }, o.patience ?? 2500))
      o.ask(text).catch((error) => {
        report(error)
        speak('Sorry, I could not take that. Please say it again.')
      })
    },
    lost: (why) => {
      report(new Error(`A call's speech stream was lost: ${why}`))
      finish()
    },
  })
  let finish = () => {
    if (over) return
    over = true
    for (let t of timers) clearTimeout(t)
    let heard = stream.close()
    try {
      o.wire.close(1000)
    } catch {
      // Already closed by the other side.
    }
    o.done({
      seconds: (Date.now() - started) / 1000,
      heard: heard.dollars,
    }).catch(report).finally(finished)
  }
  o.wire.addEventListener('message', (event) => {
    let frame: Frame = o.line.frame(String(event.data))
    if (frame.audio) stream.send(frame.audio)
    if (frame.stop) finish()
  })
  o.wire.addEventListener('close', finish)
  o.wire.addEventListener('error', finish)
  timers.push(setTimeout(() => {
    speak('I have to go now. Call me back any time.')
    timers.push(setTimeout(() => o.hangup().catch(report), 6000))
  }, (o.minutes ?? MINUTES) * 60_000))
  speak(o.hello)
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
    answered: (text) => {
      if (streamed) speak(buffer)
      else speak(text)
      buffer = ''
      asked = streamed = false
    },
    waiting: () => asked,
    ended,
  }
}

// The calls this object carries, by space and person: one each.
let live = new Map<string, Call>()
let keyOf = (space: string, person: string) => `${space} ${person}`

/** The call a person is on with this space's Operator, if any. */
export let callOf = (space: string, person: string) =>
  live.get(keyOf(space, person))

/**
 * Words an Operator session wrote: spoken on the call its person is on, when
 * the session is their conversation (not a helper's) and they are waiting.
 */
export let typed = async (
  store: Parameters<typeof ownerOf>[0],
  session: string,
  text: string,
) => {
  if (!live.size) return
  let [row] = await store.g.get([session])
  if (!row || row.spawned) return
  let owner = await ownerOf(store, session)
  let call = owner && callOf(owner.space, owner.person)
  if (call?.waiting()) call.typed(text)
}

type Upgraded = Socket & { accept: () => void }

/**
 * A client socket as Workers open one: a fetch with `Upgrade`, which also
 * carries the key as the request's Authorization rather than a subprotocol.
 * What is sent before it opens waits in @yaks/speech's `turns`.
 */
export let upgraded = (url: string, [scheme, key]: string[]): Socket => {
  let on: Record<string, ((event: { data?: unknown }) => void)[]> = {}
  let fire = (type: string, event: { data?: unknown } = {}) =>
    on[type]?.forEach((f) => f(event))
  let ws: Upgraded | undefined
  fetch(url.replace(/^wss:/, 'https:'), {
    headers: { upgrade: 'websocket', authorization: `${scheme} ${key}` },
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
  return {
    send: (data) => ws?.send(data),
    close: (code, reason) => ws?.close(code, reason),
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
}

// The WebSocket pair the runtime makes, declared structurally as build.ts does.
declare let WebSocketPair: { new (): { 0: unknown; 1: Upgraded } }

/**
 * `/operator/call` in the space's object: the provider's stream accepted,
 * and the conversation run on it until the call ends.
 */
export let answering = (
  env: Env,
  operator: Operator,
  space: Space,
  ticket: Ticket,
  armed: () => Promise<void> | undefined,
): Response => {
  let provider = PROVIDERS[ticket.via]
  let speech = speechOf(env)
  if (!provider?.line || !provider.caller || !speech) {
    return new Response(null, { status: 404 })
  }
  let line = provider.line
  let pair = new WebSocketPair()
  pair[1].accept()
  let turn = 0
  let key = keyOf(space.eid, ticket.person)
  let call: Call = converse({
    wire: pair[1],
    line,
    listen: (told) =>
      turns({ ...speech, format: line.format, told, open: upgraded }),
    say: async (text) =>
      (await speaking(env, space, text, {
        format: line.format,
        voice: operatorVoice(space),
      })).body,
    ask: async (text) => {
      await receive(
        operator.store,
        {
          space: space.eid,
          person: ticket.person,
          channel: 'voice',
          address: ticket.from,
          reply_to: ticket.to,
          via: ticket.via,
        },
        text,
        {
          id: requestId(space.eid, `${ticket.via}:${ticket.call}:${++turn}`),
        },
      )
      await armed()
    },
    hello: `Hi, it's ${space.operator ?? 'your Operator'}.`,
    done: async ({ seconds, heard }) => {
      if (live.get(key) == call) live.delete(key)
      await countedSpend(
        env,
        space,
        heard + seconds / 60 * line.perMinute,
        0,
      )
    },
    hangup: () => provider.caller!(settings(env)).hangup(ticket.call),
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
