// The guide is the only page an agent building an app reads (mcp.ts serves it
// as the connector's one resource), so a list printed there has to be true.
// What can rot is anything the guide PRINTS that the code also decides: the
// reserved words a manifest is refused against (the code's list, never the
// page's — C-32624 item 1), the components an app has, whose COLUMNS and
// types are what a refusal now spells and what the seventh user test had to
// guess five times over (C-32675 items 2 and 3), and the doors and limits an
// app's own worker.js runs under (T-32780).
import { assert, assertEquals } from '@std/assert'
import { RESERVED } from '../../src/store/vocab.ts'
import { comps, typeName } from '../../src/types.ts'
import { SHIM, upload } from './dispatch.ts'
import type { Env } from './env.ts'

let guide = Deno.readTextFileSync(
  new URL('./public/guide.md', import.meta.url),
)

Deno.test('the guide prints every word vocab.json may not use', () => {
  // The indented block after the sentence that introduces it — the guide's
  // one code block of bare words.
  let block = guide.split(/taken:\n\n/)[1]?.split('\n\n')[0] ?? ''
  assertEquals(block.trim().split(/\s+/), RESERVED)
})

// One bullet of the component list: the names it heads with, and the
// `col` (type) pairs it prints before the sentence explaining them.
let bullets = () => {
  let section = guide.split('## The components an app has today')[1]
    ?.split('\n## ')[0] ?? ''
  return section.split('\n- ').slice(1).map((bullet) => {
    let [head, ...said] = bullet.replace(/\s+/g, ' ').split(' — ')
    return {
      names: [...head.matchAll(/`(\w+)`/g)].map((m) => m[1]),
      cols: [
        ...said.join(' — ').split('. ')[0]
          .matchAll(/`(\w+)` \(([^)]+)\)/g),
      ].map((m) => [m[1], m[2]]),
    }
  })
}

// The third list that can rot, and the one an app's code is written against:
// what `env` holds inside a worker.js, and the limits it runs under. Both are
// the platform's own — the shim decides the first, the upload's metadata the
// second — and a guide that names a door the shim does not hand over teaches
// an app to break at the first request (T-32780).
Deno.test('the guide names the doors a worker is actually given', () => {
  let section = guide.split('## Code of your own')[1]?.split('\n## ')[0] ?? ''
  assert(section, 'the guide no longer teaches worker.js')
  // Every `env.NAME` the section spells, minus the secrets, which are the
  // app's own names and not the platform's.
  let named = new Set(
    [...section.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]),
  )
  for (let door of ['STORE', 'FILES']) {
    assert(named.has(door), `the guide never shows env.${door}`)
    assert(SHIM.includes(`${door}: door(`), `the shim hands over no ${door}`)
  }
  for (let door of named) {
    if (door == 'STORE' || door == 'FILES') continue
    // Anything else must read as a secret the person set, not a door.
    assert(
      /app_secret_set|WEATHER_KEY/.test(section),
      `the guide shows env.${door} and never says where it came from`,
    )
  }
})

Deno.test('the guide prints the limits an app is really held to', async () => {
  let section = guide.split('## Code of your own')[1]?.split('\n## ')[0] ?? ''
  let meta: { limits: { cpu_ms: number; subrequests: number } } = {
    limits: {
      cpu_ms: 0,
      subrequests: 0,
    },
  }
  let was = globalThis.fetch
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let form = await new Request(input as string, init).formData()
    meta = JSON.parse(await (form.get('metadata') as File).text())
    return Response.json({ success: true, errors: [], result: {} })
  }) as typeof fetch
  try {
    await upload({ CF_ACCOUNT: 'a', CF_WORKERS_TOKEN: 't' } as Env, 'a/b', '')
  } finally {
    globalThis.fetch = was
  }
  assert(
    section.includes(`${meta.limits.cpu_ms}ms of CPU`),
    `the guide does not say ${meta.limits.cpu_ms}ms of CPU`,
  )
  assert(
    section.includes(`${meta.limits.subrequests} subrequests`),
    `the guide does not say ${meta.limits.subrequests} subrequests`,
  )
})

Deno.test('the guide prints every column of every component it lists', () => {
  let listed = bullets()
  let named = listed.flatMap((b) => b.names)
  // A parse that found nothing would pass every assertion below.
  assert(named.includes('doc') && named.includes('blob'), named.join(' '))
  for (let { names, cols } of listed) {
    for (let name of names) {
      assert(comps[name], `the guide lists ${name}, which is no component`)
      assertEquals(
        cols,
        Object.entries(comps[name]).map(([col, t]) => [col, typeName(t)]),
        name,
      )
    }
  }
})
