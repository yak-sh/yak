import * as fs from '@yaks/file/io'
import { streamingFetch } from '@yaks/process/http'
import { CallError } from '@yaks/tools/errors'
import {
  BROWSE_REPLY,
  type BrowseFrame,
  waitRoom,
} from '@yaks/platform/browser-visit'
import {
  frames,
  HTML_BYTES,
  IncompleteBrowse,
  streamed,
} from '@yaks/platform/browser-wire'
import {
  type Browse,
  browse,
  type Browsed,
  type BrowseFile,
  replayBrowse,
  traced,
} from './api.ts'
import { FORWARDED } from './forward.ts'

let read = async function* (path: string) {
  using file = await fs.open(path)
  while (true) {
    let chunk = new Uint8Array(64 * 1024)
    let n = await file.read(chunk)
    if (n == null) return
    yield chunk.subarray(0, n)
  }
}

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

export let documentAt = async (path: string): Promise<BrowseFile> => {
  let { size, isFile } = await fs.stat(path)
  if (!isFile) throw new CallError('html_file', 'Choose an HTML file.')
  if (size > HTML_BYTES) {
    throw new CallError(
      'html_too_large',
      `An HTML file must fit in ${HTML_BYTES / 1_000_000} MB.`,
    )
  }
  return () => ({
    size,
    body: size ? streamed(read(path)) : undefined,
  })
}

let screenshots = async (
  response: Response,
  to: string,
  signal: AbortSignal,
): Promise<Browsed & { files: string[] }> => {
  await fs.mkdir(to, { recursive: true })
  let temp = await fs.makeTempDir({ dir: to, prefix: '.browse-' })
  let files: string[] = []
  let result: BrowseFrame & { kind: 'result' } | undefined
  try {
    for await (let { head, body } of frames<BrowseFrame>(response.body)) {
      if (result) throw new IncompleteBrowse('data after browse result')
      if (head.kind == 'reset') {
        files = []
      } else if (head.kind == 'shot' && body) {
        let name = head.name.replace(/[^\w.-]+/g, '-') + '.png'
        await write(`${temp}/${name}`, body, signal)
        files.push(name)
      } else if (head.kind == 'result' && !body) {
        result = head
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
) => {
  let fetch = session.startsWith(FORWARDED) ? undefined : connect
  let signal = AbortSignal.timeout(waitFor(asked))
  let response: Response | undefined
  try {
    response = await browse(session, asked, file, signal, fetch)
    return await screenshots(response, to, signal)
  } catch (cause) {
    if (
      !signal.aborted && !(cause instanceof IncompleteBrowse) &&
      (response || !(cause instanceof TypeError))
    ) throw cause
    let where = response ? ` (HTTP ${response.status})${traced(response)}` : ''
    throw new IncompleteBrowse(
      replayBrowse(asked)
        ? `/api/browse lost its answer${where}. Try the visit again.`
        : `/api/browse lost its answer${where}. The browser may have taken the requested steps. Check the page before retrying.`,
      { cause },
    )
  } finally {
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
) => {
  try {
    return await attempt(session, asked, to, file, connect)
  } catch (e) {
    if (e instanceof IncompleteBrowse && replayBrowse(asked)) {
      await recovered?.(e)
      return await attempt(session, asked, to, file, connect)
    }
    throw e
  }
}
