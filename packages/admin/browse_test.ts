import * as fs from '@yaks/file/io'
import { streamingFetch } from '@yaks/process/http'
import type { BrowseFrame } from '@yaks/platform/browser-visit'
import { mockupAssets, mockupPath } from '@yaks/platform/browser-mockup'
import {
  BROWSE_IDLE,
  header,
  PROGRESS,
  readAsk,
  streamed,
  WIRE,
} from '@yaks/platform/browser-wire'
import { clock, equal, test, throws } from '@yaks/testing'
import type { Browse } from './api.ts'
import { mockupAt } from './browse-files.ts'
import { visit } from './browse.ts'

let asked = { url: 'https://yaks.app/manage' }
let shot = (name: string, size: number) =>
  header({ kind: 'shot', name } satisfies BrowseFrame, size)
let end = header(
  {
    kind: 'result',
    result: {
      text: 'Seen',
      status: 200,
      duration: 20,
      errors: [],
      dialogs: [],
      console: [],
    },
  } satisfies BrowseFrame,
)

let answer = (chunks: (Uint8Array | Error)[]) =>
  new Response(
    streamed((async function* () {
      for (let chunk of chunks) {
        if (chunk instanceof Error) throw chunk
        yield chunk
      }
    })()),
    { headers: { 'content-type': WIRE, 'cf-ray': 'test-ray' } },
  )

let inDir = async (run: (dir: string) => Promise<void>) => {
  let dir = await fs.makeTempDir()
  try {
    await run(dir)
  } finally {
    await fs.remove(dir, { recursive: true })
  }
}

test('a directory upload sends the same local files again after a lost answer', () =>
  inDir(async (dir) => {
    let root = `${dir}/mockup`
    await fs.mkdir(`${root}/images`, { recursive: true })
    let page = '<img src="images/picture.webp">'
    let picture = new Uint8Array([0, 255, 27])
    await fs.writeTextFile(`${root}/index.html`, page)
    await fs.writeFile(`${root}/images/picture.webp`, picture)
    await fs.writeTextFile(`${root}/.draft`, 'private')
    await fs.symlink('.draft', `${root}/link.txt`)
    let { url, mockup, upload } = await mockupAt(root, '/')
    let calls = 0
    let send: typeof fetch = async (input, init) => {
      let req = new Request(input, init)
      let file = await readAsk<Browse>(req.body)
      try {
        let files = await mockupAssets(file.head.mockup!, file.size!, file.body)
        equal(
          new TextDecoder().decode(files.get(mockupPath(file.head.url)!)),
          page,
        )
        equal(files.get('/images/picture.webp'), picture)
        equal([...files.keys()].sort(), ['/images/picture.webp', '/index.html'])
      } finally {
        await file.close()
      }
      return ++calls == 1
        ? answer([shot('end', 2), new Uint8Array([1])])
        : answer([shot('end', 1), new Uint8Array([1]), end])
    }
    let got = await visit('session', { url, mockup }, dir, upload, send)
    equal(got.text, 'Seen')
    equal(calls, 2)
  }))

test('a read-only visit replaces a dropped answer with a whole one on a new connection', () =>
  inDir(async (dir) => {
    let opened = 0, ended = 0
    let bytes = new Uint8Array(180_000).fill(28)
    let ready = [
      shot('before', bytes.length),
      bytes,
      shot('end', 2),
      bytes.subarray(0, 2),
    ]
    let send = streamingFetch(() => {
      let first = ++opened == 1
      return {
        fetch: () =>
          Promise.resolve(
            first
              ? answer([
                shot('discard', 1),
                bytes.subarray(0, 1),
                shot('end', 2),
                new Error('connection lost'),
              ])
              : answer([...ready, end.subarray(0, 2), end.subarray(2)]),
          ),
        close: () => {
          ended++
        },
      }
    })
    let got = await visit('session', asked, dir, undefined, send)
    equal([opened, ended], [2, 2])
    equal(got.text, 'Seen')
    equal(got.files, [`${dir}/before.png`, `${dir}/end.png`])
    equal(await fs.readFile(got.files[0]), bytes)
    equal(await fs.readFile(got.files[1]), bytes.subarray(0, 2))
    equal(
      (await Array.fromAsync(fs.readDir(dir))).map((entry) => entry.name)
        .sort(),
      ['before.png', 'end.png'],
    )
  }))

test('a visit with actions reports an incomplete answer without replaying or publishing its screenshots', () =>
  inDir(async (dir) => {
    let calls = 0
    let send: typeof fetch = () => {
      calls++
      return Promise.resolve(answer([shot('end', 1), new Uint8Array([1])]))
    }
    await fs.writeTextFile(`${dir}/end.png`, 'previous')
    let failure = await throws(() =>
      visit(
        'session',
        { ...asked, steps: [{ tap: 'button' }] },
        dir,
        undefined,
        send,
      )
    ) as Error
    equal(failure.message.includes('HTTP 200) (Cloudflare ray test-ray)'), true)
    equal(
      failure.message.includes('waiting for the next frame after end.png'),
      true,
    )
    equal(
      failure.message.endsWith(
        'The browser may have taken the requested steps. Check the page before retrying.',
      ),
      true,
    )
    equal(calls, 1)
    equal(await fs.readTextFile(`${dir}/end.png`), 'previous')
    equal((await Array.fromAsync(fs.readDir(dir))).map((entry) => entry.name), [
      'end.png',
    ])
  }))

test('a gateway failure before the screenshot stream retries once with the same read-only visit', () =>
  inDir(async (dir) => {
    let calls = 0
    let send: typeof fetch = () =>
      Promise.resolve(
        ++calls == 1
          ? new Response('Admin forwarding failed', { status: 502 })
          : answer([shot('end', 1), new Uint8Array([1]), end]),
      )
    let got = await visit('session', asked, dir, undefined, send)
    equal(got.text, 'Seen')
    equal(calls, 2)
  }))

test('a complete result publishes its files while the HTTP body is still open', () =>
  inDir(async (dir) => {
    let cancelled = false
    let send: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(shot('end', 1))
              controller.enqueue(new Uint8Array([7]))
              controller.enqueue(end)
            },
            cancel() {
              cancelled = true
            },
          }),
          { headers: { 'content-type': WIRE } },
        ),
      )
    let time = clock()
    let got = await visit(
      'session',
      asked,
      dir,
      undefined,
      send,
      undefined,
      time,
    )
    equal(got.text, 'Seen')
    equal(await fs.readFile(got.files[0]), new Uint8Array([7]))
    equal(cancelled, true)
  }))

test('an interactive visit can receive its result or failure after a gap in progress', () =>
  inDir(async (dir) => {
    let reset = header({ kind: 'reset' } satisfies BrowseFrame)
    let failure = header(
      {
        kind: 'result',
        result: {
          failed: 'The browser session closed while taking step 1',
          duration: 17_000,
        },
      } satisfies BrowseFrame,
    )
    for (
      let { reply, expected } of [
        {
          reply: [shot('end', 1), new Uint8Array([7]), end],
          expected: 'Seen',
        },
        {
          reply: [failure],
          expected: 'The browser session closed while taking step 1',
        },
      ]
    ) {
      let time = clock()
      let waiting = Promise.withResolvers<void>()
      let ready = Promise.withResolvers<void>()
      let calls = 0
      let send: typeof fetch = () => {
        calls++
        return Promise.resolve(
          new Response(
            streamed((async function* () {
              yield reset
              waiting.resolve()
              await ready.promise
              yield* reply
            })()),
            { headers: { 'content-type': WIRE, [PROGRESS]: '1' } },
          ),
        )
      }
      let result = visit(
        'session',
        { ...asked, steps: [{ tap: 'button' }] },
        dir,
        undefined,
        send,
        undefined,
        time,
      ).catch((e: Error) => e)
      await waiting.promise
      await time.advance(17_000)
      ready.resolve()
      let got = await result
      equal(calls, 1)
      equal(got instanceof Error ? got.message : got.text, expected)
      if (!(got instanceof Error)) {
        equal(await fs.readFile(got.files[0]), new Uint8Array([7]))
      }
    }
  }))

test('a silent stream retries a read-only visit and describes the last phase', () =>
  inDir(async (dir) => {
    let time = clock()
    let listening = Promise.withResolvers<void>()
    let calls = 0
    let signal: AbortSignal | null | undefined
    let send: typeof fetch = (_, init) => {
      if (++calls != 1) {
        return Promise.resolve(
          answer([shot('end', 1), new Uint8Array([7]), end]),
        )
      }
      signal = init?.signal
      let sent = false
      let body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent) {
            listening.resolve()
            return
          }
          controller.enqueue(header(
            {
              kind: 'progress',
              stage: 'waiting for the page to reach DOMContentLoaded',
              ms: 2_000,
            } satisfies BrowseFrame,
          ))
          sent = true
        },
      }, { highWaterMark: 0 })
      return Promise.resolve(
        new Response(body, {
          headers: {
            'content-type': WIRE,
            [PROGRESS]: '1',
            'cf-ray': 'stalled-ray',
          },
        }),
      )
    }
    let failures: string[] = []
    let result = visit(
      'session',
      { url: 'https://yaks.app/app/~token/?query=private' },
      dir,
      undefined,
      send,
      (e) => {
        failures.push(e.message)
      },
      time,
    )
    await listening.promise
    await time.advance(BROWSE_IDLE)
    equal((await result).text, 'Seen')
    equal(calls, 2)
    equal(signal?.aborted, true)
    equal(failures, [
      '/api/browse lost its answer (HTTP 200) (Cloudflare ray stalled-ray) for https://yaks.app/app/<preview> while waiting for the page to reach DOMContentLoaded (2000 ms in the browser service) after 8000 ms: no browse bytes for 8 seconds. Try the visit again.',
    ])
  }))
