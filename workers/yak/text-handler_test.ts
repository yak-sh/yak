// A text to an app's number is handled by the app's own code (D-467): a
// builder whose query matches each text that arrived, and whose tool is one
// of the app's commands answered by its worker.js. The worker is handed the
// match and answers the rows it means, which land in the app's store.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { toolEid } from '@yaks/tools'
import { parseTools } from '@yaks/tools/declared'
import type { Bundle, Comp } from '@yaks/graph'
import type { Dispatch } from './door.ts'
import { appStore, storeName } from './directory.ts'
import { appArrived } from './app-texts.ts'
import { ADA_OWNS, platform, seeded } from './serving-probe.ts'

let NUMBER = '+12695550100', FROM = '+12695550142'
let words = {
  $defs: {
    on_text: {
      tool: true,
      description: 'Answer a text that arrived',
      worker: '/on-text',
      input: { binding: { type: 'object' } },
    },
  },
}

test('a builder hands each text that arrives to the app worker and keeps the rows it answers', async () => {
  await using p = platform()
  let { env } = p
  let { space, app } = await seeded(env, 'private')
  let asked: { path: string; args: Record<string, unknown> }[] = []
  env.DISPATCH = {
    get: () => ({
      fetch: async (req: Request) => {
        let args = await req.json()
        asked.push({ path: new URL(req.url).pathname, args })
        let { binding } = args as {
          binding: { entities: string[]; vars: Record<string, string> }
        }
        return Response.json({
          outputs: [{
            slot: 'reply',
            inputs: [binding.entities[0]],
            components: {
              text: { from: NUMBER, to: binding.vars.from },
              doc: { body: `Got it: ${binding.vars.body}` },
            },
          }],
        })
      },
    }),
  } as Dispatch
  let store = appStore(env.STORE, space, app)
  let send = async (path: string, body: unknown) => {
    let res = await store(path, {
      method: 'POST',
      body: JSON.stringify(body),
    }, ADA_OWNS)
    assertEquals(res.status, 200, await res.text())
  }
  let rows = async (q: string): Promise<Bundle[]> => {
    await p.object(storeName(space, app)).alarm()
    await p.settled()
    return await (await store(
      `/query?q=${encodeURIComponent(q)}`,
      {},
      ADA_OWNS,
    ))
      .json()
  }
  await send('/tools', parseTools(words, ['doc']))
  await send('/apply', [{
    entity: { eid: crypto.randomUUID() },
    builder: {
      query: `$t .text.to=${NUMBER}, text.from=$from, doc.body=$body`,
      to: toolEid('on_text'),
    },
  }])
  await appArrived(env, { space, app }, {
    id: 'msg-1',
    from: FROM,
    to: NUMBER,
    text: 'Table for two at seven?',
    at: new Date().toISOString(),
    via: 'voipms',
    rcs: false,
    media: [],
  })
  let [reply] = await until(async () => {
    let found = await rows('.built.current=true&*')
    return found.length ? found : null
  }, { label: 'the worker answer kept as a builder output' })
  assertEquals(reply.text, { from: NUMBER, to: FROM })
  assertEquals((reply.doc as Comp).body, 'Got it: Table for two at seven?')
  assertEquals(asked.map((a) => a.path), ['/cookbook/on-text'])
})
