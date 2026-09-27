// A command-line sign-in finishes in one process, with the callback confined
// to private input and the authorization controller.

import { assertEquals, assertRejects } from '@std/assert'
import {
  type Authorization,
  authorizeCLI,
  readHidden,
} from './authorize_cli.ts'

Deno.test('connection authorize lists targets without starting a sign-in', async () => {
  let calls: string[] = []
  let auth: Authorization = {
    run: (action) => {
      calls.push(action)
      return Promise.resolve({
        servers: ['site [site]', 'openai'],
      })
    },
    close: () => {
      calls.push('close')
      return Promise.resolve()
    },
  }
  assertEquals(await authorizeCLI(auth), 'site [site]\nopenai')
  assertEquals(calls, ['list', 'close'])
})

Deno.test('private line accepts bracketed paste across reads and masks it', async () => {
  let bytes = new TextEncoder().encode(
    '\x1b[200~http://localhost/callback?state=synthetic\x1b[201~\r',
  )
  let chunks = [
    bytes.subarray(0, 2),
    bytes.subarray(2, 29),
    bytes.subarray(29, 52),
    bytes.subarray(52),
  ]
  let marks: boolean[] = []
  let line = await readHidden(
    () => Promise.resolve(chunks.shift() ?? null),
    (shown) => marks.push(shown),
  )
  assertEquals(line, 'http://localhost/callback?state=synthetic')
  assertEquals(marks, [true])
})

Deno.test('private line ignores pasted line endings until paste closes', async () => {
  let chunks = [new TextEncoder().encode(
    '\x1b[200~\rhttp://localhost/callback?state=synthetic\n\x1b[201~\r',
  )]
  assertEquals(
    await readHidden(() => Promise.resolve(chunks.shift() ?? null)),
    'http://localhost/callback?state=synthetic',
  )
})

Deno.test('connection authorize sends a pasted return URL only to completion', async () => {
  let callback = 'http://localhost:8765/oauth/callback?code=private&state=s'
  let calls: [string, string | undefined, string | undefined][] = []
  let shown: string[] = []
  let auth: Authorization = {
    run: (action, name, value) => {
      calls.push([action, name, value])
      return Promise.resolve(
        action == 'begin'
          ? { url: 'https://issuer.test/authorize?state=s' }
          : { message: 'Connected.' },
      )
    },
    close: () => {
      calls.push(['close', undefined, undefined])
      return Promise.resolve()
    },
  }
  let said = await authorizeCLI(auth, 'site', {
    say: (line) => shown.push(line),
    hidden: () => Promise.resolve(callback),
  })
  assertEquals(said, 'Connected.')
  assertEquals(calls, [
    ['begin', 'site', undefined],
    ['complete', 'site', callback],
    ['close', undefined, undefined],
  ])
  assertEquals(shown.some((line) => line.includes('private')), false)
})

Deno.test('connection authorize closes an unfinished attempt', async () => {
  let closed = false
  let auth: Authorization = {
    run: () => Promise.resolve({ url: 'https://issuer.test/authorize' }),
    close: () => {
      closed = true
      return Promise.resolve()
    },
  }
  await assertRejects(
    () =>
      authorizeCLI(auth, 'site', {
        say: () => {},
        hidden: () => Promise.resolve(''),
      }),
    Error,
    'cancelled',
  )
  assertEquals(closed, true)
})
