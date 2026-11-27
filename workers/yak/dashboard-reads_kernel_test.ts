// What a space's Dashboard waits on (T-3990): the directory once, for the
// space and every part it draws, and its Operator, which a colo's note of the
// space starts beside that read rather than after it.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { connector, fresh, signIn } from './probe.ts'
import { dashboardPath } from '@yaks/platform/routes'
import { WAKE } from './door.ts'
import type { Namespace } from '@yaks/durable-object/door'
import type { Stored } from '@yaks/workerd/cache'
import { system } from '@yaks/fp'
import { parseHTML } from 'linkedom'

// Every call through `ns`, by its path, each let through once `gate` opens.
let watched = (ns: Namespace, calls: string[], gate: () => Promise<void>) => {
  let get = ns.get.bind(ns)
  ns.get = ((id: Parameters<Namespace['get']>[0]) => {
    let stub = get(id)
    let fetch = stub.fetch.bind(stub)
    return Object.assign(Object.create(stub), {
      fetch: async (req: Request) => {
        calls.push(new URL(req.url).pathname)
        await gate()
        return fetch(req)
      },
    })
  }) as Namespace['get']
}

// A colo's cache in memory.
let shelf = (): Stored => {
  let kept = new Map<string, string>()
  return {
    match: (req) =>
      Promise.resolve(
        kept.has(req.url) ? new Response(kept.get(req.url)) : undefined,
      ),
    put: async (req, res) => void kept.set(req.url, await res.text()),
  }
}

let directory: string[] = []
let operator: string[] = []
let held: Promise<void> | undefined
// Moved past the window a page's wake of the Operator lasts (build-door.ts
// `woken`), so the next open is the first in a while.
let skew = 0
let k = await fresh({}, (env) => {
  env.CLOCK = { ...system, now: () => Date.now() + skew }
  watched(env.STORE, directory, () => held ?? Promise.resolve())
  watched(env.BUILDER, operator, () => Promise.resolve())
  let notes = shelf()
  env.OPERATOR_CACHE = () => Promise.resolve(notes)
})
let them = await signIn(k)
let slug = them.email.split('@')[0]
await connector(k, them.cookie).tool('app_new', {
  space: slug,
  slug: 'notes',
  title: 'Notes',
})
let open = async () => {
  let res = await k.at('yaks.app', dashboardPath(slug), {
    headers: { cookie: them.cookie },
  })
  await res.text()
  return res.status
}

test('a Dashboard asks the directory once for everything it draws', async () => {
  await open()
  directory.length = 0
  assertEquals(await open(), 200)
  assertEquals(directory, ['/reads'])
})

test('a Dashboard sends its apps and ask box before its activity', async () => {
  let res = await k.at('yaks.app', dashboardPath(slug), {
    headers: { cookie: them.cookie },
  })
  let body = res.body!.getReader()
  let decode = new TextDecoder()
  let first = decode.decode((await body.read()).value)
  let opening = parseHTML(first).document
  assertEquals(opening.querySelector('.Dash_AppName')?.textContent, 'Notes')
  assert(opening.querySelector('.Dash_Ask textarea[name=say]'))
  assertEquals(opening.querySelector('.Dash_Updates'), null)
  let last = decode.decode((await body.read()).value)
  let full = parseHTML(first + last).document
  assert(full.querySelector('.Dash_Work'))
  assert(full.querySelector('.Dash_Updates'))
  assert(full.querySelector('.Dash script[data-page-graph]'))
  assertEquals((await body.read()).done, true)
})

test('a Dashboard starts its Operator before the directory answers', async () => {
  await open()
  skew += 60_000
  let release = () => {}
  held = new Promise((done) => release = done)
  operator.length = 0
  let page = open()
  // The colo's note, read as the page starts, wakes the Operator while the
  // directory still holds the page's read.
  for (let i = 0; i < 100 && !operator.includes(WAKE); i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  assert(operator.includes(WAKE), operator.join(', '))
  held = undefined
  release()
  assertEquals(await page, 200)
})
