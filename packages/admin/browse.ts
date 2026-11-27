import * as fs from '@yaks/file/io'
import { type Clock, system } from '@yaks/fp'
import { streamingFetch } from '@yaks/process/http'
import { CallError } from '@yaks/tools/errors'
import {
  BROWSE_REPLY,
  type BrowseFrame,
  waitRoom,
} from '@yaks/platform/browser-visit'
import {
  BROWSE_IDLE,
  browsePage,
  frames,
  IncompleteBrowse,
  PROGRESS,
} from '@yaks/platform/browser-wire'
import {
  type Browse,
  browse,
  browseAnswer,
  type Browsed,
  type BrowseFile,
  replayBrowse,
  traced,
} from './api.ts'
import { FORWARDED } from './forward.ts'

let missing = (e: unknown): undefined => {
  if (!fs.isNotFound(e)) throw e
}

let scratch = async (to: string) => {
  await fs.mkdir(to, { recursive: true })
  return await fs.makeTempDir({ dir: to, prefix: '.browse-' })
}

let receive = async (
  path: string | undefined,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) => {
  using file = path == null ? undefined : await fs.open(path, {
    createNew: true,
    write: true,
    mode: 0o600,
  }).catch(missing)
  await body.pipeTo(
    new WritableStream<Uint8Array>({
      async write(chunk) {
        // Keep reading the browser's reply even if the caller's scratch is gone.
        if (!file) return
        for (let at = 0; at < chunk.length;) {
          let wrote = await file.write(chunk.subarray(at))
          if (!wrote) throw new Error('Could not write the screenshot')
          at += wrote
        }
      },
    }),
    { signal },
  )
  return file != null
}

let screenshots = async (
  source: ReadableStream<Uint8Array> | null,
  to: string,
  signal: AbortSignal,
  progress: (stage: string) => void,
): Promise<Browsed & { files: string[]; missingShots: boolean }> => {
  let temp = await scratch(to).catch(missing)
  let staging = temp
  let next = 0
  let files: [name: string, slot: number][] = []
  let result: BrowseFrame & { kind: 'result' } | undefined
  try {
    for await (let { head, body } of frames<BrowseFrame>(source)) {
      if (head.kind == 'progress' && !body) {
        progress(`${head.stage} (${head.ms} ms in the browser service)`)
      } else if (head.kind == 'reset' && !body) {
        files = []
        progress('waiting for the browser to render the page')
      } else if (head.kind == 'shot' && body) {
        // A recording's frames are JPEGs and say so; a screenshot is a PNG.
        let name = head.name.replace(/[^\w.-]+/g, '-')
        if (!name.endsWith('.jpg')) name += '.png'
        let slot = next++
        progress(`receiving screenshot ${name}`)
        if (!await receive(staging && `${staging}/${slot}`, body, signal)) {
          staging = undefined
        }
        files.push([name, slot])
        progress(`waiting for the next frame after ${name}`)
      } else if (head.kind == 'result' && !body) {
        result = head
        break
      } else {
        throw new IncompleteBrowse('invalid browse frame')
      }
    }
    if (!result) throw new IncompleteBrowse('missing browse result')
    let said = result.result
    if ('failed' in said) {
      if (said.refusal) throw new CallError(said.refusal, said.failed)
      throw new Error(said.failed)
    }
    if (files.at(-1)?.[0] != 'end.png') {
      throw new IncompleteBrowse('missing final screenshot')
    }
    let latest = new Map(files)
    let published = new Set<string>()
    if (staging) {
      for (let [name, slot] of latest) {
        let moved = await fs.rename(`${staging}/${slot}`, `${to}/${name}`)
          .then(() => true, missing)
        if (!moved) break
        published.add(name)
      }
    }
    return {
      ...said,
      files: files.flatMap(([name]) =>
        published.has(name) ? [`${to}/${name}`] : []
      ),
      missingShots: published.size != latest.size,
    }
  } finally {
    if (temp) await fs.remove(temp, { recursive: true, force: true })
  }
}

let waitFor = (asked: Browse) =>
  15_000 + BROWSE_REPLY + waitRoom({
    ...asked,
    view: { width: 390, height: 844, wait: 1000, ...asked.view },
  })

let attempt = async (
  session: string,
  asked: Browse,
  to: string,
  file: BrowseFile | undefined,
  connect: typeof fetch,
  time: Clock,
) => {
  let fetch = session.startsWith(FORWARDED) ? undefined : connect
  let stop = new AbortController()
  let signal = stop.signal
  let start = time.now()
  let stage = 'waiting for browse response headers'
  let replay = replayBrowse(asked)
  let cancel = time.after(
    waitFor(asked),
    () => stop.abort(new Error('browse reply deadline expired')),
  )
  let idle = () => {}
  let heard = () => {
    idle()
    idle = time.after(
      BROWSE_IDLE,
      () =>
        stop.abort(
          new Error(`no browse bytes for ${BROWSE_IDLE / 1000} seconds`),
        ),
    )
  }
  let response: Response | undefined
  try {
    response = await browse(session, asked, file, signal, fetch)
    await browseAnswer(response)
    stage = 'waiting for the first browse frame'
    // A gap in progress is enough to try a read on a new connection.
    // Give actions the full deadline so a delayed stream can still deliver
    // their only result.
    let retryOnIdle = replay && response.headers.get(PROGRESS) == '1'
    if (retryOnIdle) heard()
    let source = response.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (retryOnIdle) heard()
          controller.enqueue(chunk)
        },
      }),
      { signal },
    ) ?? null
    return await screenshots(source, to, signal, (next) => {
      stage = next
    })
  } catch (cause) {
    if (
      !signal.aborted && !(cause instanceof IncompleteBrowse) &&
      (response || !(cause instanceof TypeError))
    ) throw cause
    let where = response ? ` (HTTP ${response.status})${traced(response)}` : ''
    let reason = signal.aborted ? signal.reason : cause
    let detail = signal.aborted || cause instanceof IncompleteBrowse
      ? (reason as Error).message
      : 'connection failed'
    let loss = `/api/browse lost its answer${where} for ${
      browsePage(asked.url)
    } while ${stage} after ${time.now() - start} ms`
    throw Object.assign(
      new IncompleteBrowse(
        `${loss}: ${detail}. ${
          replay
            ? 'Try the visit again.'
            : 'The browser may have taken the requested steps. Check the page before retrying.'
        }`,
        { cause: reason },
      ),
      { fault: 'browse lost its answer' },
    )
  } finally {
    cancel()
    idle()
    await response?.body?.cancel().catch(() => {})
  }
}

export let visit = async (
  session: string,
  asked: Browse,
  to: string,
  file?: BrowseFile,
  connect = streamingFetch(),
  recovered?: (e: Error) => void | Promise<void>,
  time = system,
) => {
  try {
    return await attempt(session, asked, to, file, connect, time)
  } catch (e) {
    if (e instanceof IncompleteBrowse && replayBrowse(asked)) {
      await recovered?.(e)
      return await attempt(session, asked, to, file, connect, time)
    }
    throw e
  }
}
