// A door's refusal escaping into the router still reaches its caller, with
// one tail line and no exception filing. Service bindings supply the same
// errors a part relays from a Store, without booting a Store for this test.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { handler } from './kernel.ts'
import type { Env } from './env.ts'
import { answered } from './meta.ts'
import { CallError } from '@yaks/tools'

test('escaped refusals keep their JSON and status at machine doors, and pages stay pages', async () => {
  let logs: string[] = []
  let log = console.log
  console.log = (...args) => logs.push(args.join(' '))
  try {
    for (let status of [400, 401, 403, 409, 429]) {
      let body = { error: { code: 'denied', message: 'the door says no' } }
      let no = {
        fetch: async () => {
          throw await answered(Response.json(body, { status }))
        },
      }
      let env = { MCP: no, IDENTITY: no } as unknown as Env
      for (let path of ['/mcp', '/api/app_list', '/login']) {
        let out = await handler.fetch(
          new Request(`https://yaks.app${path}`),
          env,
        )
        assertEquals(out.status, status)
        if (path == '/login') {
          assertStringIncludes(
            out.headers.get('content-type') ?? '',
            'text/html',
          )
          assertStringIncludes(await out.text(), 'Something went wrong')
        } else assertEquals(await out.json(), body)
      }
    }
    let body = { error: { code: 'bad_ref', message: 'no word' } }
    let env = {
      MCP: {
        fetch: () => {
          throw new Error(JSON.stringify(body))
        },
      },
    } as unknown as Env
    let out = await handler.fetch(new Request('https://yaks.app/mcp'), env)
    assertEquals(out.status, 400)
    assertEquals(await out.json(), body)
    assertEquals(logs.length, 16)
    assertStringIncludes(logs[0], 'GET yaks.app/mcp refused 400:')
    assertStringIncludes(logs[0], 'the door says no')
  } finally {
    console.log = log
  }
})

test('a typed tool refusal escaping before the tool runs keeps its code and message', async () => {
  for (
    let [code, status] of [
      ['arguments', 400],
      ['access', 403],
      ['missing', 404],
      ['conflict', 409],
      ['limit', 429],
    ] as const
  ) {
    let message = 'vocab.json: fight.dealt is already text'
    let env = {
      MCP: {
        fetch: () => {
          throw new CallError(code, message)
        },
      },
      META: { apply: () => Promise.resolve([]) },
    } as unknown as Env
    let out = await handler.fetch(new Request('https://yaks.app/mcp'), env)
    assertEquals(out.status, status)
    assertEquals(await out.json(), { error: { code, message } })
  }
})
