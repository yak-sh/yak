// A command-line sign-in finishes in one process, with the callback confined
// to private input and the authorization controller.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { resolvers } from '@yaks/fp'
import { OAuthError } from '@yaks/oauth'
import {
  type Authorization,
  authorizeCLI,
  readHidden,
} from '@yaks/connections/authorize-cli'
import type { Listen } from './loopback.ts'
import { REDIRECT } from './signin.ts'

test('connection authorize lists targets without starting a sign-in', async () => {
  let calls: string[] = []
  let auth: Authorization = {
    run: (action) => {
      calls.push(action)
      return Promise.resolve({
        servers: ['site [site]', 'OpenAI'],
      })
    },
    close: () => {
      calls.push('close')
      return Promise.resolve()
    },
  }
  assertEquals(
    await authorizeCLI(auth),
    'site [site]\nOpenAI\n\nsign in to one with: yak auth <name>',
  )
  assertEquals(calls, ['list', 'close'])
})

test('private line accepts bracketed paste across reads and masks it', async () => {
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

test('private line ignores pasted line endings until paste closes', async () => {
  let chunks = [new TextEncoder().encode(
    '\x1b[200~\rhttp://localhost/callback?state=synthetic\n\x1b[201~\r',
  )]
  assertEquals(
    await readHidden(() => Promise.resolve(chunks.shift() ?? null)),
    'http://localhost/callback?state=synthetic',
  )
})

test('connection authorize sends a pasted return URL only to completion', async () => {
  let callback = 'http://localhost:8765/oauth/callback?code=private&state=s'
  let calls: [
    string,
    string | undefined,
    Parameters<Authorization['run']>[2],
  ][] = []
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

test('connection authorize closes an unfinished attempt', async () => {
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

test('a refused return URL can be pasted again into the same attempt', async () => {
  let calls: string[] = []
  let shown: string[] = []
  let pastes = ['invalid', 'http://localhost/callback?state=ok']
  let auth: Authorization = {
    run: (action, _name, callback) => {
      calls.push(action)
      if (action == 'begin') {
        return Promise.resolve({ url: 'https://issuer.test' })
      }
      if (callback == 'invalid') {
        throw new OAuthError('callback', 'the return URL is invalid')
      }
      return Promise.resolve({ message: 'Connected.' })
    },
    close: () => {
      calls.push('close')
      return Promise.resolve()
    },
  }
  assertEquals(
    await authorizeCLI(auth, 'site', {
      say: (line) => shown.push(line),
      hidden: () => Promise.resolve(pastes.shift() ?? ''),
    }),
    'Connected.',
  )
  assertEquals(calls, ['begin', 'complete', 'complete', 'close'])
  assertEquals(shown.filter((line) => line.includes('Paste')).length, 2)
})

let browserReturn = `${REDIRECT}?state=current&code=from-browser`
let pastedReturn = `${REDIRECT}?state=current&code=from-paste`
let begin = {
  url: 'https://issuer.test/authorize?state=current',
  redirectUrl: REDIRECT,
}

let waiting = (options: {
  available?: boolean
  complete?: (callback: string) => Promise<void>
} = {}) => {
  let calls: string[] = []
  let lines: string[] = []
  let hosts: [string, number][] = []
  let closed: string[] = []
  let ready = resolvers<AbortSignal>()
  let paste = resolvers<string>()
  let ended: (() => void) | undefined
  let handle: Parameters<Listen>[1] | undefined
  let auth: Authorization = {
    run: async (action, _name, callback) => {
      if (action == 'begin') return begin
      calls.push(String(callback))
      await options.complete?.(String(callback))
      return { message: 'yaks.app connected.' }
    },
    close: () => Promise.resolve(),
  }
  let connected = authorizeCLI(auth, 'yaks.app', {
    say: (line) => lines.push(line),
    hidden: (signal, onEnd) => {
      ended = onEnd
      ready.resolve(signal!)
      signal!.addEventListener('abort', () => paste.reject(signal!.reason), {
        once: true,
      })
      return paste.promise
    },
    listen: ({ hostname, port }, request) => {
      hosts.push([hostname, port])
      if (options.available === false) return
      handle = request
      return {
        shutdown: () => {
          closed.push(hostname)
          return Promise.resolve()
        },
      }
    },
  })
  let visit = async (url = browserReturn, method = 'GET') =>
    await handle!(new Request(url, { method }))
  let end = () => {
    ended?.()
    paste.resolve('')
  }
  return {
    calls,
    lines,
    hosts,
    closed,
    ready: ready.promise,
    paste,
    end,
    connected,
    visit,
  }
}

test('the browser completes yaks.app authorization and cancels masked input', async () => {
  let sign = waiting()
  let input = await sign.ready
  assertEquals(sign.hosts, [['127.0.0.1', 8765], ['::1', 8765]])
  assertEquals(
    (await sign.visit(`${REDIRECT}/other?state=current`)).status,
    404,
  )
  assertEquals((await sign.visit(browserReturn, 'POST')).status, 404)
  assertEquals(
    (await sign.visit(browserReturn.replace('localhost', '127.0.0.1'))).status,
    404,
  )
  assertEquals(
    (await sign.visit(`${REDIRECT}?state=another&code=unused`)).status,
    400,
  )
  assertEquals(sign.calls, [])
  let page = await sign.visit()
  assertEquals(await sign.connected, 'yaks.app connected.')
  assertEquals([page.status, page.headers.get('cache-control')], [
    200,
    'no-store',
  ])
  assertEquals((await page.text()).includes('from-browser'), false)
  assertEquals(sign.lines.some((line) => line.includes('from-browser')), false)
  assertEquals(sign.calls, [browserReturn])
  assertEquals(input.aborted, true)
  assertEquals(sign.closed, ['127.0.0.1', '::1'])
})

test('a paste that arrives first completes when the browser returns in the same turn', async () => {
  let started = resolvers<void>(), exchanged = resolvers<void>()
  let sign = waiting({
    complete: () => {
      started.resolve()
      return exchanged.promise
    },
  })
  await sign.ready
  sign.paste.resolve(pastedReturn)
  let page = sign.visit()
  await started.promise
  exchanged.resolve()
  assertEquals(await sign.connected, 'yaks.app connected.')
  assertEquals((await page).status, 409)
  assertEquals(sign.calls, [pastedReturn])
  assertEquals(sign.closed, ['127.0.0.1', '::1'])
})

test('a returned code can be retried in the browser after input ends', async () => {
  let sign = waiting({
    complete: (callback) => {
      if (callback != browserReturn) {
        throw new OAuthError('code', 'the return carried no single code')
      }
      return Promise.resolve()
    },
  })
  await sign.ready
  sign.end()
  let incomplete = `${REDIRECT}?state=current`
  assertEquals((await sign.visit(incomplete)).status, 400)
  assertEquals((await sign.visit()).status, 200)
  assertEquals(await sign.connected, 'yaks.app connected.')
  assertEquals(sign.calls, [incomplete, browserReturn])
})

test('yaks.app authorization keeps the paste when its port is unavailable', async () => {
  let sign = waiting({ available: false })
  await sign.ready
  sign.paste.resolve(pastedReturn)
  assertEquals(await sign.connected, 'yaks.app connected.')
  assertEquals(sign.calls, [pastedReturn])
})
