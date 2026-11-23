import * as fs from '@yaks/file/io'
import { streamingFetch } from '@yaks/process/http'
import type { BrowseFrame } from '@yaks/platform/browser-visit'
import { header, streamed, WIRE } from '@yaks/platform/browser-wire'
import { equal, test, throws } from '@yaks/testing'
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
    equal(
      failure.message,
      '/api/browse lost its answer (HTTP 200) (Cloudflare ray test-ray). The browser may have taken the requested steps. Check the page before retrying.',
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
