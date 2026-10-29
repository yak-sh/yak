// The gateway reaches the named Files entrypoint through a response, so a
// reported storage failure must keep its cause across that boundary.
import { assertRejects } from '@std/assert'
import { equal, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { blobResponse } from './apps.ts'
import * as files from './files.ts'
import { within } from './defects.ts'
import { r2RawObjects } from './lib/objects.ts'
import { platform } from './serving-probe.ts'

let internal = new Error(
  'head: We encountered an internal error. Please try again. (10001)',
)
let broken = new TypeError('bad bucket adapter')
void internal.stack
void broken.stack
let body = new Uint8Array([0, 1, 2, 3, 4, 5])

let setup = async (
  verb: 'head' | 'get' | 'body',
  error: Error,
  failures: number,
  method = 'GET',
  range?: string,
) => {
  let reports: Bundle[] = [], waits = 0, calls = 0
  let scenario = platform({
    ERRORS: { send: (rows) => (reports.push(...rows), Promise.resolve()) },
  })
  let { env } = scenario
  r2RawObjects(env.BLOBS, () => (waits++, Promise.resolve()))
  let sha = 'a'.repeat(64)
  await env.BLOBS.put('photos/' + sha, body)
  let head = env.BLOBS.head.bind(env.BLOBS)
  let get = env.BLOBS.get.bind(env.BLOBS)
  let fails = (key: string) => key.endsWith(sha) && ++calls <= failures
  if (verb == 'head') {
    env.BLOBS.head = (key) => fails(key) ? Promise.reject(error) : head(key)
  } else if (verb == 'get') {
    env.BLOBS.get = (key, options) =>
      fails(key) ? Promise.reject(error) : get(key, options)
  }
  if (verb == 'body') {
    env.BLOBS.get = async (key, options) => {
      let object = await get(key, options)
      if (!fails(key) || !object) return object
      let first = calls == 1
      let offset = options?.range.offset ?? 0
      return {
        ...object,
        body: new ReadableStream<Uint8Array>({
          pull: (controller) => {
            if (first) {
              first = false
              controller.enqueue(body.slice(offset, offset + 2))
            } else controller.error(error)
          },
        }),
      }
    }
  }
  env.FILES = {
    fetch: (req) =>
      within(
        env,
        { request: 'Files fetch' },
        () => files.fetch(req, env),
      ),
  }

  return {
    scenario,
    reports,
    counts: () => [calls, waits],
    run: () =>
      within(env, {}, () =>
        blobResponse(
          (seek) =>
            files.blobBytes(
              env,
              { eid: 'app' },
              'photos/',
              sha,
              seek.headers.get('range'),
              seek.method,
            ),
          sha,
          { etag: '"representation"' },
          new Request('https://ada.yaks.app/photos/api/blob/' + sha, {
            method,
            headers: range ? { range } : {},
          }),
          { request: 'GET /api/blob' },
        )),
  }
}

let scenarios = await Promise.all([
  setup('head', internal, 1),
  setup('get', internal, 1, 'GET', 'bytes=2-4'),
  setup('head', internal, 1, 'HEAD'),
  setup('head', internal, Infinity),
  setup('get', broken, Infinity),
  setup('body', internal, 1, 'GET', 'bytes=1-4'),
  setup('body', internal, Infinity),
  setup('body', broken, Infinity),
])

for (
  let [i, name, status, bytes] of [
    [0, 'a transient R2 HEAD', 200, body],
    [1, 'a transient R2 range GET', 206, body.slice(2, 5)],
    [2, 'a transient R2 HEAD on a HEAD request', 200, new Uint8Array()],
    [5, 'an R2 body failure partway through a range', 206, body.slice(1, 5)],
  ] as const
) {
  test(`${name} recovers before the blob gateway answers`, async () => {
    let { scenario, run, counts, reports } = scenarios[i]
    try {
      let answer = await run()
      equal(answer.status, status)
      equal(new Uint8Array(await answer.arrayBuffer()), bytes)
      equal(counts(), [2, 1])
      equal(reports, [])
    } finally {
      await scenario[Symbol.asyncDispose]()
    }
  })
}

for (
  let [i, name, error, attempts] of [
    [3, 'R2 that stays down', internal, 5],
    [4, 'a non-R2 failure', broken, 1],
  ] as const
) {
  test(`${name} reports its cause once across Files and the blob gateway`, async () => {
    let { scenario, run, counts, reports } = scenarios[i]
    try {
      let answer = await run()
      equal([answer.status, await answer.json()], [503, {
        error: { code: 'blob_unavailable', message: 'blob_unavailable' },
      }])
      equal(counts(), [attempts, attempts - 1])
      let errors = reports.filter((row) => row.exception)
      equal(errors.length, 1)
      equal((errors[0].exception as Comp).value, error.message)
      equal((errors[0].error as Comp).tags, { request: 'Files fetch' })
    } finally {
      await scenario[Symbol.asyncDispose]()
    }
  })
}

for (
  let [i, name, error, attempts] of [
    [6, 'a lasting R2 tail failure', internal, 5],
    [7, 'a non-R2 tail failure', broken, 1],
  ] as const
) {
  test(`${name} reports once while streaming`, async () => {
    let { scenario, run, reports, counts } = scenarios[i]
    try {
      let answer = await run()
      await assertRejects(() => answer.arrayBuffer(), Error, error.message)
      equal(counts(), [attempts, attempts - 1])
      let errors = reports.filter((row) => row.exception)
      equal(errors.length, 1)
      equal((errors[0].exception as Comp).value, error.message)
    } finally {
      await scenario[Symbol.asyncDispose]()
    }
  })
}
