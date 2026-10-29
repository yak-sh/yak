/** One process owns one local kernel. Nothing reaches a deployed account. */
import { type Sample, type Samples, stopwatch } from '@yaks/benchmark'
import { client, connector, fresh, meta, onPlus } from '../workers/yak/probe.ts'
import { bindings, external, FORMS, forms } from './platform-forms.ts'
import { management, VIEWS } from './platform-management.ts'
import { d1 } from '../packages/d1/testing.ts'
import type { D1Like } from '@yaks/d1'
import { content, NAMES } from './platform-waits.ts'

// The probe's standard binding already stands in for mail and Cloudflare. Its
// Stripe binding must stay disabled even when the caller is a test runner.
console.log = console.error
Deno.env.delete('STRIPE_KEY')
Deno.env.delete('STRIPE_PRICE')
let selected: string[] = JSON.parse(
  Deno.env.get('BENCH_NAMES') ?? JSON.stringify(NAMES),
)
let wanted = (name: string) => selected.includes(name)
let scratch = await Deno.makeTempDir({ prefix: 'T-127095-platform-waits-' })
Deno.env.set('TMPDIR', scratch)
// Outside calls are denied before a byte can leave this process. Only exact
// local payment fixtures and analytics answers are admitted: populated visits,
// and a GraphQL answer of nothing used and nothing killed for the directory's
// meter and kill sweep, whose wakes fire when a run crosses one.
const network = globalThis.fetch
const denied: string[] = []
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init)
  const u = new URL(req.url)
  if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
    return network(input, init)
  }
  const fixture = external(req)
  if (fixture) return fixture
  const analytics = u.origin == 'https://analytics.benchmark.invalid' &&
    req.method == 'POST'
  if (analytics && u.pathname == '/graphql') {
    return Response.json({ data: { viewer: { accounts: [] } } })
  }
  if (analytics && u.pathname == '/accounts/local/analytics_engine/sql') {
    const sql = await req.text()
    const row = sql.includes(' AS day')
      ? { day: new Date().toISOString().slice(0, 10), views: 42 }
      : sql.includes(' AS path')
      ? { path: '/notes/', views: 42 }
      : sql.includes(' AS site')
      ? { site: 'benchmark.invalid', views: 42 }
      : { country: 'US', views: 42 }
    return Response.json({ data: [row] })
  }
  denied.push(req.url)
  throw new Error(
    `platform wait external request refused: ${req.method} ${u.origin}${u.pathname}`,
  )
}
let k: Awaited<ReturnType<typeof fresh>> | undefined
try {
  k = await fresh({
    ...bindings,
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    CF_ANALYTICS_TOKEN: 'local-fixture',
    CF_ACCOUNT: 'local',
    ANALYTICS_API: 'https://analytics.benchmark.invalid',
  })
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
  // Keep the original six HTML workloads unchanged; populated pages are
  // separate measurements so none of their existing records is raised.
  let original = [
    'management/html',
    ...['settings', 'connections', 'trash', 'billing', 'connect'].map((v) =>
      `management/${v}-html`
    ),
    'app/html',
    'connector/app-list',
    'connector/file-list',
    'connector/graph-query',
    'connector/graph-apply',
  ]
  for (let name of original.filter(wanted)) {
    await acts[name]()
    let samples = []
    for (let i = 0; i < 7; i++) {
      let took = stopwatch()
      await acts[name]()
      samples.push({
        ...took(),
        source: 'local-kernel-http',
      })
    }
    result[name] = samples
  }
  let needForms = FORMS.some(wanted)
  let views = VIEWS.filter((view) =>
    wanted(`management/${view}-populated-html`) ||
    ['people', 'new', 'visits', 'selling'].includes(view) &&
      wanted(`management/${view}-html`)
  )
  for (let slug of needForms || views.length ? ['owner', 'bench-waits'] : []) {
    let [row] = await meta(k).query(`.space.slug=${slug}`)
    await onPlus(k, String(row.entity.eid))
  }
  let submissions = needForms ? await forms(k, scratch) : {}
  let dashboard = views.length ? await management(k) : undefined
  for (let view of views) {
    let name = `management/${view}-populated-html`
    let act = async () =>
      content(
        await k!.at(k!.host, dashboard!.path(view), {
          headers: { cookie: k!.owner.cookie },
        }),
        dashboard!.wanted[view],
      )
    await act()
    let samples: Sample[] = []
    result[name] = samples
    for (let i = 0; i < 7; i++) {
      let took = stopwatch()
      await act()
      samples.push({
        ...took(),
        source: 'local-kernel-http/populated',
      })
    }
    if (['people', 'new', 'visits', 'selling'].includes(view)) {
      result[`management/${view}-html`] = result[name]
    }
  }
  for (
    let [name, op] of Object.entries(submissions).filter(([name]) =>
      wanted(name)
    )
  ) {
    await op.prepare?.()
    await op.act()
    let samples: Sample[] = []
    result[name] = samples
    for (let i = 0; i < 7; i++) {
      await op.prepare?.()
      let took = stopwatch()
      await op.act()
      samples.push({
        ...took(),
        source: 'local-kernel-http/submission-and-readback',
      })
    }
  }
  if (denied.length) {
    throw new Error(`external calls attempted: ${denied.join(', ')}`)
  }
  if (selected.some((name) => result[name] === undefined)) {
    throw new Error('missing platform metric')
  }
  await Deno.stdout.write(
    new TextEncoder().encode(
      'PLATFORM_WAITS_RESULT=' +
        JSON.stringify(
          Object.fromEntries(selected.map((name) => [name, result[name]])),
        ) + '\n',
    ),
  )
} finally {
  await k?.stop()
  globalThis.fetch = network
  await Deno.remove(scratch, { recursive: true })
}
