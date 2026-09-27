// A command-line sign-in finishes in one process, with the callback confined
// to private input and the authorization controller.

import { assertEquals, assertRejects } from '@std/assert'
import { type Authorization, authorizeCLI } from './authorize_cli.ts'

Deno.test('connection authorize lists targets without starting a sign-in', async () => {
  let calls: string[] = []
  let auth: Authorization = {
    run: (action) => {
      calls.push(action)
      return Promise.resolve({
        servers: ['site [site]', 'OpenAI (model provider)'],
      })
    },
    close: () => {
      calls.push('close')
      return Promise.resolve()
    },
  }
  assertEquals(await authorizeCLI(auth), 'site [site]\nOpenAI (model provider)')
  assertEquals(calls, ['list', 'close'])
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
