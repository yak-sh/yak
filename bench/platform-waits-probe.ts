/** One process owns one local kernel. Nothing reaches a deployed account. */
import type { Samples } from '@yaks/benchmark'
import { client, connector, fresh } from '../workers/yak/probe.ts'
import { paint } from './platform-paint.ts'
import { browser } from '../workers/yak/probe.ts'
import { content, NAMES } from './platform-waits.ts'

// The probe's standard binding already stands in for mail and Cloudflare. Its
// Stripe binding must stay disabled even when the caller is a test runner.
console.log = console.error
Deno.env.delete('STRIPE_KEY')
Deno.env.delete('STRIPE_PRICE')
let scratch = await Deno.makeTempDir({ prefix: 'T-127095-platform-waits-' })
Deno.env.set('TMPDIR', scratch)
let k: Awaited<ReturnType<typeof fresh>> | undefined
try {
  k = await fresh()
  let agent = connector(k, k.owner.cookie)
  let space = 'bench-waits', app = { space, app: 'notes' }
  await agent.tool('space_new', { slug: space, title: 'Bench waits' })
  await agent.tool('app_new', { space, slug: app.app, title: 'Bench notes' })
  let c = client(k, `${space}.${k.host}`, app.app, k.owner.cookie)
  let page = await c.put(
    '/index.html',
    '<!doctype html><h1>Platform wait content</h1>',
  )
  if (!page.ok) throw new Error(`fixture upload: ${await page.text()}`)
  await page.body?.cancel()
  // app_deploy is wholly local: the kernel's Cloudflare and build bindings are
  // test implementations; this never calls the platform deployment CLI.
  await agent.tool('app_deploy', app)
  let ids = Array.from({ length: 256 }, () => crypto.randomUUID())
  await agent.tool('graph_apply', {
    ...app,
    bundles: ids.map((eid, i) => ({
      entity: { eid },
      $app: 'notes',
      doc: { title: `Note ${i}` },
    })),
  })
  await k.deliveries?.()
  let revision = 0
  let acts: Record<string, () => Promise<unknown>> = {
    'management/html': async () =>
      content(
        await k!.at(k!.host, '/manage?space=bench-waits', {
          headers: { cookie: k!.owner.cookie },
        }),
        '/notes/',
      ),
    'app/html': async () =>
      content(
        await k!.at(`${space}.${k!.host}`, '/notes/', {
          headers: { cookie: k!.owner.cookie },
        }),
        '<h1>Platform wait content</h1>',
      ),
    'connector/app-list': async () => {
      let text = await agent.tool('app_list', { space })
      if (!text.includes('notes')) throw new Error('missing app listing')
    },
    'connector/file-list': async () => {
      let text = await agent.tool('app_files', { ...app, op: 'list' })
      if (!text.includes('index.html')) throw new Error('missing file listing')
    },
    'connector/graph-query': async () => {
      let rows = JSON.parse(
        await agent.tool('graph_query', {
          ...app,
          q: '.doc .order=doc.title .limit=50',
        }),
      )
      if (!Array.isArray(rows) || rows.length != 50) {
        throw new Error('query must answer 50 populated rows')
      }
    },
    'connector/graph-apply': async () => {
      let title = `Changed ${++revision}`
      let text = await agent.tool('graph_apply', {
        ...app,
        bundles: [{ entity: { eid: ids[0] }, doc: { title } }],
      })
      if (!text.includes(ids[0])) {
        throw new Error('apply returned no saved entity')
      }
    },
  }
  let result: Record<string, Samples> = {}
  for (let view of ['settings', 'connections', 'trash', 'billing', 'connect']) {
    acts[`management/${view}-html`] = async () =>
      content(
        await k!.at(k!.host, `/manage/${view}?space=${space}`, {
          headers: { cookie: k!.owner.cookie },
        }),
        '</html>',
      )
  }
  for (let name of NAMES.filter((name) => !name.startsWith('app/paint-'))) {
    await acts[name]()
    let samples = []
    for (let i = 0; i < 7; i++) {
      let start = performance.now()
      await acts[name]()
      samples.push({
        value: performance.now() - start,
        source: 'local-kernel-http',
      })
    }
    result[name] = samples
  }
  let origin = browser(k, `${space}.${k.host}`, k.owner.cookie)
  try {
    let values = await paint(origin.origin + '/notes/', scratch + '/chrome')
    Object.assign(result, values)
  } finally {
    await origin.stop()
  }
  await Deno.stdout.write(
    new TextEncoder().encode(
      'PLATFORM_WAITS_RESULT=' + JSON.stringify(result) + '\n',
    ),
  )
} finally {
  await k?.stop()
  await Deno.remove(scratch, { recursive: true })
}
