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

let write = async (
  path: string,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) => {
  using file = await fs.open(path, {
    create: true,
    write: true,
    truncate: true,
    mode: 0o600,
  })
  await body.pipeTo(
    new WritableStream<Uint8Array>({
      async write(chunk) {
        for (let at = 0; at < chunk.length;) {
          let wrote = await file.write(chunk.subarray(at))
          if (!wrote) throw new Error('Could not write the screenshot')
          at += wrote
        }
      },
    }),
    { signal },
  )
}

let screenshots = async (
  source: ReadableStream<Uint8Array> | null,
  to: string,
  signal: AbortSignal,
  progress: (stage: string) => void,
): Promise<Browsed & { files: string[] }> => {
  await fs.mkdir(to, { recursive: true })
  let temp = await fs.makeTempDir({ dir: to, prefix: '.browse-' })
  let files: string[] = []
  let result: BrowseFrame & { kind: 'result' } | undefined
  try {
    for await (let { head, body } of frames<BrowseFrame>(source)) {
      if (head.kind == 'progress' && !body) {
        progress(`${head.stage} (${head.ms} ms in the browser service)`)
      } else if (head.kind == 'reset' && !body) {
        files = []
        progress('waiting for the browser to render the page')
      } else if (head.kind == 'shot' && body) {
        let name = head.name.replace(/[^\w.-]+/g, '-') + '.png'
        progress(`receiving screenshot ${name}`)
        await write(`${temp}/${name}`, body, signal)
        files.push(name)
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
    if (files.at(-1) != 'end.png') {
      throw new IncompleteBrowse('missing final screenshot')
    }
    for (let file of new Set(files)) {
      await fs.rename(`${temp}/${file}`, `${to}/${file}`)
    }
    return { ...said, files: files.map((file) => `${to}/${file}`) }
  } finally {
    await fs.remove(temp, { recursive: true })
  }
}

let waitFor = (asked: Browse) =>
  15_000 + BROWSE_REPLY + waitRoom({
    ...asked,
    audit: false,
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
  let cancel = time.after(
    waitFor(asked),
    () => stop.abort(new Error('browse deadline expired')),
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
    let pulsed = response.headers.get(PROGRESS) == '1'
    if (pulsed) heard()
    let source = response.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (pulsed) heard()
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
          replayBrowse(asked)
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
