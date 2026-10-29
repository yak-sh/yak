import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { denoDir, observe, type Progress } from './test.ts'

test('denoDir follows explicit cache, XDG, and platform defaults', () => {
  assertEquals(
    denoDir({ DENO_DIR: '/cache', HOME: '/home' }, 'linux'),
    '/cache',
  )
  assertEquals(
    denoDir({ XDG_CACHE_HOME: '/xdg', HOME: '/home' }, 'linux'),
    '/xdg/deno',
  )
  assertEquals(denoDir({ HOME: '/home' }, 'linux'), '/home/.cache/deno')
  assertEquals(
    denoDir({ HOME: '/home' }, 'darwin'),
    '/home/Library/Caches/deno',
  )
  assertEquals(
    denoDir({ LOCALAPPDATA: 'C:\\cache' }, 'windows'),
    'C:\\cache\\deno',
  )
})

let colored = ['one ... \x1b[0m', '\x1b[32mok\x1b[0m (1ms)\n']
  .map((chunk) => new TextEncoder().encode(chunk))

test('colored test results count as completed', async () => {
  let progress = {
    name: 'loading tests',
    at: 0,
    phase: 'loading' as Progress['phase'],
    count: 0,
    failed: [] as string[],
  }
  await observe(colored, progress)
  assertEquals(progress.name, 'one')
  assert(progress.at > 0)
  assertEquals(progress.count, 1)
})

let reported = new ReadableStream<Uint8Array>({
  start(stream) {
    for (
      let chunk of [
        'ok (1ms)\nfirst ... a report\n',
        'more output\nok\x1b[90m (2s)',
        '\x1b[0m\nsecond ... ok (1ms)\n',
        'third ... details\nFAILED (3ms)\nFAILED (4ms)\n',
      ]
    ) stream.enqueue(new TextEncoder().encode(chunk))
    stream.close()
  },
})

test('test results after console output count once and only while a test runs', async () => {
  let progress = {
    name: 'loading tests',
    at: 0,
    phase: 'loading' as Progress['phase'],
    count: 0,
    failed: [] as string[],
  }
  await observe(reported, progress)
  assertEquals(progress.name, 'third')
  assert(progress.at > 0)
  assertEquals(progress.count, 3)
  assertEquals(progress.failed, ['third'])
})
