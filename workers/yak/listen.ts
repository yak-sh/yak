// Listening: every app's ./api/speech/listen door, a page's microphone heard
// as it is spoken, onto @yaks/speech `turns`. The page opens a WebSocket,
// sends raw samples in the format it named, and is told each turn as it
// ends: who said it and its seconds into the recording. Asked by whoever may
// ask the app's models (models.ts `modelAccess`), and charged to the space's
// one budget as hearing a recording is (speech.ts `charged`), a minute held
// at a time.
//
// Nothing of a stream is kept here. A page that loses its socket, or is told
// the stream failed, opens another `at` the second its last turn ended and
// sends its audio from there on, so a turn the provider was still hearing is
// heard again and none is lost. A deploy that drops the socket is the same.
import type { Upgrade } from '@yaks/api'
import { type Clock, system } from '@yaks/fp'
import { mint } from '@yaks/graph'
import { ModelError } from '@yaks/model'
import {
  heard,
  type Open,
  type Raw,
  type Socket,
  type Stream,
  type Turn,
  turns,
} from '@yaks/speech'
import { workerUpgrade } from '@yaks/workerd'
import type { Answer } from './apps.ts'
import { defect } from './defects.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { reserved } from './model-spend.ts'
import { modelAccess } from './models.ts'
import { paused, speechOf, tied, upgrading } from './speech.ts'

let LISTEN = { request: 'speech listen' }

// A held minute: the next is held this many seconds before it runs out.
let LEAD = 10

// How long a stream ended is given to tell its last turns, in milliseconds.
let ENDS = 10_000

/**
 * The format a page names in its query: `encoding` (`linear16`, 16-bit
 * little-endian PCM, or `mulaw`) and `rate`, by default 16 kHz PCM; null for
 * any other.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { formatOf } from './listen.ts'
 * let of = (q: string) => formatOf(new URLSearchParams(q))
 * equal(of(''), { encoding: 'linear16', rate: 16000 })
 * equal(of('encoding=mulaw&rate=8000'), { encoding: 'mulaw', rate: 8000 })
 * equal(of('encoding=mp3'), null)
 * equal(of('rate=1000'), null)
 * ```
 */
export let formatOf = (q: URLSearchParams): Raw | null => {
  let encoding = q.get('encoding') ?? 'linear16'
  let rate = Number(q.get('rate') ?? 16000)
  if (encoding != 'linear16' && encoding != 'mulaw') return null
  if (!Number.isInteger(rate) || rate < 8000 || rate > 48000) return null
  return { encoding, rate }
}

/** The stream a meeting is heard with: one that tells speakers apart, where
 * the provider has one. */
export let meeting = (streams: Stream[]): Stream =>
  streams.find((s) => s.speakers) ?? streams[0]

// Seconds to the millisecond, as a page is told them.
let ms = (seconds: number) => Math.round(seconds * 1000) / 1000

// A stream's minutes charged to `space`, a minute held at a time: each held
// before it is heard, refused in the directory's own transaction once the
// budget can't cover it (model-spend.ts `reserved`), and each settled at what
// was heard in it.
let minutes = (
  env: Env,
  space: Space,
  stream: Stream,
  report: (error: unknown) => void,
) => {
  let minute = heard(stream, 60)
  let holds: Awaited<ReturnType<typeof reserved>>[] = []
  let settled = 0
  let asking: Promise<void> | undefined
  let hold = () =>
    asking ??= reserved(
      env,
      space,
      (left) => minute <= left ? { dollars: minute } : null,
      mint(),
      { what: 'models', source: 'voice' },
    ).then((h) => void holds.push(h)).finally(() => asking = undefined)
  // What was heard in hold `k`; the last also what was heard past it.
  let used = (seconds: number, k: number) =>
    heard(
      stream,
      Math.max(
        0,
        k == holds.length - 1
          ? seconds - k * 60
          : Math.min(60, seconds - k * 60),
      ),
    )
  return {
    hold,
    /** at `seconds` heard: every minute heard settled, and the next held
     * before the last runs out, refused once the budget can't cover it */
    heard: (seconds: number) => {
      while (settled < holds.length - 1 && seconds >= (settled + 1) * 60) {
        holds[settled++].settle(minute).catch(report)
      }
      return !asking && seconds > holds.length * 60 - LEAD ? hold() : undefined
    },
    /** the stream ended at `seconds`: what is held settled at what it heard */
    close: async (seconds: number) => {
      await asking?.catch(() => {})
      await Promise.all(
        holds.slice(settled).map((h, i) =>
          h.settle(used(seconds, settled + i))
        ),
      )
      settled = holds.length
    },
  }
}

// What the page sent, as audio, or null for anything else.
let bytesOf = (data: unknown) =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : null

/// sendable(1000) -> true
/// sendable(4000) -> true
/// sendable(1005) -> false
/// sendable(undefined) -> false
/** Whether a close code may be sent in a close frame, not only received:
 * 1005 and 1006 say there was none. */
export let sendable = (code?: number): code is number =>
  code == 1000 || !!code && code >= 3000 && code <= 4999

// What the page asked in a text message.
let typeOf = (data: unknown) => {
  try {
    return (JSON.parse(String(data)) as { type?: unknown })?.type
  } catch {
    return undefined
  }
}

/**
 * One page's stream, heard for `space` from `at` seconds into its recording:
 * told `ready` once it is heard, each `turn` as it ends, `done` once the page
 * said `end` and the last turns were told, or an `error` with the second to
 * open again at.
 */
export let listen = async (
  o: {
    env: Env
    space: Space
    page: Socket
    query: URLSearchParams
    open: Open
    time?: Clock
    /** how a failure is reported: to the tracker */
    report?: (error: unknown) => void
  },
) => {
  let { env, space, page } = o
  let time = o.time ?? system
  let report = o.report ?? ((error: unknown) => defect(error, LISTEN))
  let at = Number(o.query.get('at') ?? 0)
  // Where a page that opens again resumes: the end of the last turn told.
  let resume = at
  let say = (message: object) => {
    try {
      page.send(JSON.stringify(message))
    } catch {
      // The page is gone: it opens again where it last heard.
    }
  }
  let held: Uint8Array[] = []
  let over = false, ending = false
  let stream: ReturnType<typeof turns> | undefined
  let meter: ReturnType<typeof minutes> | undefined
  // What the stream heard, charged once however it ended.
  let charging: Promise<void> | undefined
  let finished = () => {
    stream?.close()
    return charging ??= stream
      ? meter!.close(stream.spent().seconds).catch(report)
      : Promise.resolve()
  }
  // The stream over, once: what it heard charged, then the page told `last`
  // and closed with `code`.
  let stop = async (last: object, code: number, reason: string) => {
    if (over) return
    over = true
    await finished()
    say(last)
    page.close(code, reason)
  }
  let failed = (code: string, message: string, close = 1011) =>
    stop({ type: 'error', code, message, at: ms(resume) }, close, code)
  let end = async () => {
    if (ending || over) return
    ending = true
    if (!stream) return
    let cancel = () => {}
    let waited = new Promise<void>((r) => cancel = time.after(ENDS, r))
    await Promise.race([stream.end(), waited])
    cancel()
    await stop(
      { type: 'done', at: ms(at + stream.spent().seconds) },
      1000,
      'done',
    )
  }
  let hear = (audio: Uint8Array) => {
    stream!.send(audio)
    meter!.heard(stream!.spent().seconds)?.catch((error) => {
      if (error instanceof ModelError) {
        return failed(error.code, error.message, 1008)
      }
      report(error)
      failed('speech_failed', 'speech did not answer: open it again at `at`')
    })
  }
  page.addEventListener('message', ({ data }) => {
    let audio = bytesOf(data)
    if (audio && !ending && !over) {
      if (stream) hear(audio)
      else held.push(audio)
    } else if (!audio && typeOf(data) == 'end') end()
  })
  // A page that closes is answered with its close, which the runtime sends
  // for us only from a later compatibility date than ours, and is told
  // nothing more; the provider's stream is closed and what was heard is
  // charged.
  page.addEventListener('close', ({ code }) => {
    if (over) return
    over = true
    finished()
    try {
      page.close(sendable(code) ? code : 1000, 'closed')
    } catch {
      // Already closed.
    }
  })
  let format = formatOf(o.query)
  if (!format || !Number.isFinite(at) || at < 0) {
    return failed(
      'bad_request',
      'open ?encoding=linear16|mulaw&rate=<8000 to 48000>&at=<seconds>',
      1008,
    )
  }
  let on = speechOf(env)
  let why = on ? await paused(env) : 'Speech is not switched on here.'
  if (why || !on) return failed('speech_off', why!)
  let chosen = meeting(on.provider.turns)
  meter = minutes(env, space, chosen, report)
  try {
    await meter.hold()
  } catch (error) {
    if (error instanceof ModelError) {
      return failed(error.code, error.message, 1008)
    }
    throw error
  }
  if (over) return void (await meter.close(0).catch(report))
  stream = turns({
    ...on,
    model: chosen.model,
    format,
    open: o.open,
    told: {
      end: (turn: Turn) => {
        resume = at + (turn.to ?? stream!.spent().seconds)
        say({
          type: 'turn',
          speaker: turn.speaker,
          text: turn.text,
          ...turn.from == undefined ? {} : { from: ms(at + turn.from) },
          to: ms(resume),
        })
      },
      lost: (reason) => {
        report(new Error(`A listening stream was lost: ${reason}`))
        failed('speech_failed', 'the stream was lost: open it again at `at`')
      },
    },
  })
  say({ type: 'ready', at: ms(at), speakers: chosen.speakers })
  for (let audio of held.splice(0)) hear(audio)
  if (ending) {
    ending = false
    await end()
  }
}

/**
 * `./api/speech/listen`: a WebSocket a page streams its microphone to and
 * hears each turn back on (listen), refused before it opens to whoever may
 * not ask the app's models. `upgrade` and `open` are the runtime's: the
 * socket a page is answered with, and the provider's stream.
 */
export let listens = (
  { upgrade = workerUpgrade, open = upgrading(LISTEN), report }: {
    upgrade?: Upgrade
    open?: Open
    report?: (error: unknown) => void
  } = {},
): Answer =>
async (asked) => {
  let { env, req, path, space, json } = asked
  if (path != '/speech/listen') return null
  if (req.headers.get('upgrade') != 'websocket') {
    return json(426, 'expected_websocket')
  }
  let denied = await modelAccess(asked)
  if (denied) return denied
  let { socket, response } = upgrade(req)
  let page = tied(socket as unknown as Socket, LISTEN)
  let query = new URL(req.url).searchParams
  listen({ env, space, page, query, open, report })
    .catch((error) => {
      ;(report ?? ((e: unknown) => defect(e, LISTEN)))(error)
      try {
        page.close(1011, 'speech_failed')
      } catch {
        // Already closed.
      }
    })
  return response
}

/** The door, on the runtime's sockets. */
export let listenDoor = listens()
