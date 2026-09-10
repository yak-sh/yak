import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import {
  COOLDOWN,
  type Event,
  type Incident,
  PATIENCE,
  REPAGE,
} from './incidents.ts'
import tail, { type Env, letter, recorder } from './tail.ts'

let event = (at = 1000, message = 'boot 123 failed'): Event => ({
  outcome: 'exception',
  scriptName: 'yak',
  entrypoint: 'Store',
  eventTimestamp: at,
  scriptVersion: { id: 'version-a' },
  event: { request: { url: 'https://jeff.yaks.app/recipes' } },
  exceptions: [{
    name: 'Error',
    message,
    stack: `Error: ${message}\n    at boot (graph.js:12:8)`,
  }],
})

let fixture = () => {
  let now = 1000
  let sent: ReturnType<typeof letter>[] = []
  let rows = new Map<
    string,
    { value: Incident; metadata: { paged: boolean } }
  >()
  let writes: number[] = []
  let fail = false
  let env: Env = {
    YAK_OWNER_EMAIL: 'owner@example.com',
    MAIL: {
      send: (mail) => {
        if (fail) return Promise.reject(new Error('mail unavailable'))
        sent.push(mail as ReturnType<typeof letter>)
        return Promise.resolve({ messageId: 'sent' })
      },
    },
    SEEN: {
      getWithMetadata: <T, M>(key: string) =>
        Promise.resolve({
          value: rows.get(key)?.value as T ?? null,
          metadata: rows.get(key)?.metadata as M ?? null,
        }),
      put: (key, value, options) => {
        writes.push(now)
        rows.set(key, { value: JSON.parse(value), metadata: options.metadata })
        return Promise.resolve()
      },
    },
  }
  let receive = () =>
    recorder(() => now, (ms) => {
      now += ms
      return Promise.resolve()
    })
  return {
    env,
    rows,
    sent,
    writes,
    receive,
    mailFails: (value: boolean) => fail = value,
  }
}

Deno.test('boot loop is one mail and one row, with all invocations counted', async () => {
  let f = fixture()
  let receive = f.receive()
  await receive(Array.from({ length: 100 }, (_, n) => event(1000 + n)), f.env)
  assertEquals(f.sent.length, 1)
  assertEquals(f.rows.size, 1)
  let [row] = f.rows.values()
  assertEquals(row.value.count, 100)
  assertEquals(row.value.first, 1000)
  assertEquals(row.value.last, 1099)
  assertEquals(f.writes.length, 1)
  assertEquals(f.sent[0].to, 'owner@example.com')
  for (
    let value of [
      row.value.signature,
      'version-a',
      'https://jeff.yaks.app/recipes',
      'boot 123 failed',
    ]
  ) {
    assertStringIncludes(f.sent[0].text, value)
  }
  // A cold isolate must consult the KV record too.
  await f.receive()([event(2000)], f.env)
  assertEquals(f.sent.length, 1)
})

Deno.test('cold recorder turns the row over after the cooldown, and rearms after a quiet day', async () => {
  let f = fixture()
  await f.receive()([event()], f.env)
  await f.receive()([event(1000 + COOLDOWN)], f.env)
  assertEquals(f.sent.length, 1)
  assertEquals([...f.rows.values()][0].value.count, 1)
  await f.receive()([event(1000 + COOLDOWN + REPAGE)], f.env)
  assertEquals(f.sent.length, 2)
  assertEquals([...f.rows.values()][0].value.count, 1)
})

Deno.test('a batch spanning two outages pages each first event', async () => {
  let f = fixture()
  await f.receive()([event(), event(1000 + REPAGE)], f.env)
  assertEquals(f.sent.length, 2)
  assertStringIncludes(f.sent[0].text, new Date(1000).toISOString())
  assertStringIncludes(f.sent[1].text, new Date(1000 + REPAGE).toISOString())
})

Deno.test('sequential invocations respect the per-key write limit', async () => {
  let f = fixture()
  let receive = f.receive()
  await receive([event()], f.env)
  await receive([event(1001)], f.env)
  await receive([event(1002)], f.env)
  assertEquals(f.sent.length, 1)
  assertEquals(f.writes, [1000, 2000, 3000])
  assertEquals([...f.rows.values()][0].value.count, 3)
})

Deno.test('concurrent batches coalesce and keep their counts', async () => {
  let f = fixture()
  let receive = f.receive()
  await Promise.all(
    Array.from({ length: 100 }, (_, n) => receive([event(1000 + n)], f.env)),
  )
  assertEquals(f.sent.length, 1)
  assertEquals([...f.rows.values()][0].value.count, 100)
  for (let n = 1; n < f.writes.length; n++) {
    assertEquals(f.writes[n] - f.writes[n - 1] >= 1000, true)
  }
})

Deno.test('failed delivery still records an incident and retries after isolate restart', async () => {
  let f = fixture()
  f.mailFails(true)
  await assertRejects(() => f.receive()([event()], f.env), AggregateError)
  assertEquals([...f.rows.values()][0].metadata.paged, false)
  f.mailFails(false)
  await f.receive()([event(2000)], f.env)
  assertEquals(f.sent.length, 1)
  assertEquals([...f.rows.values()][0].metadata.paged, true)
  assertEquals([...f.rows.values()][0].value.count, 2)
})

for (let failure of ['mail', 'kv']) {
  Deno.test(`events arriving during a failed ${failure} are still counted`, async () => {
    let f = fixture()
    let receive = f.receive()
    let started = Promise.withResolvers<void>()
    let release = Promise.withResolvers<void>()
    let first = true
    let block = async () => {
      if (!first) return
      first = false
      started.resolve()
      await release.promise
      throw new Error(`${failure} unavailable`)
    }
    if (failure == 'mail') {
      f.env.MAIL.send = async () => {
        await block()
        return { messageId: 'sent' }
      }
    } else {
      let put = f.env.SEEN.put
      f.env.SEEN.put = async (...args) => {
        await block()
        return put(...args)
      }
    }
    let a = receive([event()], f.env)
    let settled = Promise.allSettled([a])
    await started.promise
    let b = receive([event(1001)], f.env)
    let other = Promise.allSettled([b])
    // Hashing is async; let the second invocation join the pending write.
    await new Promise((resolve) => setTimeout(resolve, 10))
    release.resolve()
    await Promise.all([settled, other])
    await receive([event(1002)], f.env)
    assertEquals([...f.rows.values()][0].value.count, 3)
  })
}

Deno.test('a KV write rate limit retries without sending another page', async () => {
  let f = fixture()
  let put = f.env.SEEN.put
  let attempts = 0
  f.env.SEEN.put = (...args) => {
    if (++attempts == 1) return Promise.reject(new Error('KV PUT failed: 429'))
    return put(...args)
  }
  await f.receive()([event()], f.env)
  assertEquals(attempts, 2)
  assertEquals(f.sent.length, 1)
  assertEquals(f.writes, [2000])
})

Deno.test('a letter writes as incidents@ and says what broke in the subject', () => {
  let incident = (message: string): Incident => ({
    signature: 'abcdef0123456789',
    version: 'version-a',
    first: 1000,
    last: 1000,
    count: 1,
    sample: {
      name: 'TypeError',
      message,
      stack: `TypeError: ${message}\n    at boot (graph.js:12:8)`,
      entrypoint: 'Store',
      url: null,
    },
  })
  let mail = letter(incident('boot 123 failed'))
  assertEquals(mail.from, {
    name: 'yaks.app incidents',
    email: 'incidents@bot.yak.sh',
  })
  assertEquals(mail.subject, '[yaks.app] Store: TypeError: boot 123 failed')
  // A message with a novel in it still leaves a readable subject.
  let long = letter(incident(`${'wide '.repeat(40)}\nand deep`))
  assertEquals(long.subject.length, '[yaks.app] Store: TypeError: '.length + 80)
})

let weather = (at: number) =>
  event(
    at,
    'Connection closed: this Durable Object instance is no longer active',
  )

Deno.test('a weather fault is recorded silently, and pages on the repeat', async () => {
  let f = fixture()
  await f.receive()([weather(1000)], f.env)
  assertEquals(f.sent.length, 0)
  let [row] = f.rows.values()
  assertEquals(row.value.count, 1)
  assertEquals(row.metadata.paged, true)
  // A second inside PATIENCE (and the same outage) is a break worth a page.
  await f.receive()([weather(1000 + PATIENCE / 4)], f.env)
  assertEquals(f.sent.length, 1)
  await f.receive()([weather(1001 + PATIENCE / 4)], f.env)
  assertEquals(f.sent.length, 1)
  assertEquals([...f.rows.values()][0].value.count, 3)
})

Deno.test('a deploy reset is weather the tail drops entirely', async () => {
  let f = fixture()
  let reset = 'Durable Object reset because its code was updated.'
  await f.receive()([event(1000, reset), event(2000, reset)], f.env)
  assertEquals(f.sent.length, 0)
  assertEquals(f.rows.size, 0)
})

Deno.test('handler registers async work with waitUntil and ignores healthy traffic', async () => {
  let f = fixture()
  let work: Promise<unknown>[] = []
  tail.tail([{ outcome: 'ok' }], f.env, { waitUntil: (p) => work.push(p) })
  await Promise.all(work)
  assertEquals(work.length, 1)
  assertEquals(f.rows.size, 0)
  assertEquals(f.sent.length, 0)
})

// esbuild bundles this Worker with no aliases and no node_modules above it, so
// one RUNTIME import reaching out of workers/ fails `wrangler deploy` — and it
// fails days later, when someone tries to ship. mail-config.ts importing
// post.ts, which imports `@yaks/mail`, is what left the tail three commits
// stale while the inbox filled. Type-only imports are erased, so they are
// free; the walk follows `code` edges alone.
Deno.test('the tail bundles from workers/ alone', async () => {
  type Mod = {
    specifier: string
    dependencies?: { code?: { specifier: string } }[]
  }
  let root = new URL('./tail.ts', import.meta.url).href
  let { stdout } = await new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', root],
  }).output()
  let graph: { modules: Mod[] } = JSON.parse(new TextDecoder().decode(stdout))
  let by = new Map(graph.modules.map((m) => [m.specifier, m]))
  let run = new Set<string>()
  let walk = (specifier: string) => {
    if (run.has(specifier)) return
    run.add(specifier)
    for (let d of by.get(specifier)?.dependencies ?? []) {
      if (d.code) walk(d.code.specifier)
    }
  }
  walk(root)
  let workers = new URL('../', import.meta.url).href
  assertEquals([...run].filter((s) => !s.startsWith(workers)), [])
})
