import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { cleanup, test } from '@yaks/testing'
import { fresh, letters, seed } from './probe.ts'
import type { Env } from './env.ts'
import { configured, deployWorker } from './deploy_worker.ts'
import { retirementLetter, retirementRequested } from './durable-retirement.ts'
import { scriptName } from './dispatch.ts'
import { storeName } from './directory.ts'
import { retiredName } from './app_migrations.ts'

let env!: Env
let k = await fresh({ CF_WORKERS_TOKEN: 'fixture-token' }, (e) => env = e)
cleanup(() => k.stop())
let slug = 'retired-storage'
let them = await seed(k, [{ slug, apps: ['notes'] }])
let stranger = await seed(k, [])
let space = (await k.dir.space(slug))!
let app = (await k.dir.app(space, 'notes'))!
let script = scriptName(storeName(space, app))
let saved = retiredName('v2', 'Room')
let history = [
  { tag: 'v1', new_sqlite_classes: ['Room'] },
  { tag: 'v2', deleted_classes: ['Room'] },
  { tag: 'v3', new_sqlite_classes: ['Room'] },
]
let files = {
  'worker.js': 'export class Room {}\nexport default { fetch() {} }',
  'wrangler.json': JSON.stringify({ migrations: history }),
}
let read = (path: string) =>
  Promise.resolve(
    path in files
      ? new TextEncoder().encode(files[path as keyof typeof files])
      : null,
  )

test('retired namespaces are erased only by a person on the shared confirmation page', async () => {
  let was = globalThis.fetch
  let tag = 'v1'
  let namespaces = new Map([['Room', 'precious old data']])
  let modules = new Map<string, File>()
  let deletions = 0
  let settings: Record<string, unknown> = {}
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let req = new Request(input as string, init)
    if (!new URL(req.url).pathname.includes('/workers/dispatch/')) {
      return was(input as string, init)
    }
    let path = new URL(req.url).pathname
    let ok = (result: unknown) => Response.json({ success: true, result })
    if (req.method == 'GET' && path.endsWith('/content')) {
      let body = new FormData()
      for (let [name, file] of modules) body.append(name, file, name)
      return new Response(body)
    }
    if (req.method == 'GET' && path.endsWith('/settings')) return ok(settings)
    if (req.method == 'GET' && path.endsWith('/tags')) {
      return ok(settings.tags ?? [])
    }
    if (req.method == 'GET') {
      return ok({
        script: {
          migration_tag: tag,
          named_handlers: [...namespaces.keys()].map((name) => ({
            name,
            handlers: ['class'],
          })),
        },
      })
    }
    assertEquals(req.method, 'PUT')
    let body = init!.body as FormData
    settings = JSON.parse(await (body.get('metadata') as File).text())
    assertEquals(settings.main_module, '__yak_entry.js')
    let migration = settings.migrations as {
      old_tag: string
      new_tag: string
      steps: {
        renamed_classes?: { from: string; to: string }[]
        new_sqlite_classes?: string[]
        deleted_classes?: string[]
      }[]
    } | undefined
    if (migration) {
      assertEquals(migration.old_tag, tag)
      for (let step of migration.steps) {
        for (let { from, to } of step.renamed_classes ?? []) {
          namespaces.set(to, namespaces.get(from)!)
          namespaces.delete(from)
        }
        for (let name of step.new_sqlite_classes ?? []) {
          assert(!namespaces.has(name), `namespace ${name} already exists`)
          namespaces.set(name, 'new data')
        }
        for (let name of step.deleted_classes ?? []) {
          namespaces.delete(name)
          deletions++
        }
      }
      tag = migration.new_tag
    }
    modules = new Map(
      [...body].filter(([name]) => name != 'metadata') as [string, File][],
    )
    return ok({ version_id: 'release-id' })
  }) as typeof fetch
  try {
    let deployed = await deployWorker(
      env,
      space,
      app,
      read,
      await configured(read),
    )
    assert(deployed.ready)
    assert(deployed.retirement)
    assertEquals(deletions, 0)
    assertEquals(namespaces.get(saved), 'precious old data')
    assertEquals(namespaces.get('Room'), 'new data')
    await retirementLetter(env, k.dir, space, deployed.retirement)
    await k.settled()
    let letter = letters(k, them.email).findLast((l) =>
      l.subject.includes('retired storage')
    )!
    assert(letter)
    let link = /https:\/\/yaks\.app(\/space\/\S+)/.exec(letter.body)![1]
    let path = link.split('?')[0]
    let post = (cookie: string | null, fields: Record<string, string> = {}) =>
      k.at('yaks.app', path, {
        method: 'POST',
        headers: {
          ...(cookie ? { cookie } : { authorization: 'Bearer agent-token' }),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
      })
    let agent = await post(null)
    assertEquals(agent.status, 302)
    await agent.body?.cancel()
    let wrongOwner = await post(stranger.cookie, { confirm: 'notes' })
    assertEquals(wrongOwner.status, 404)
    await wrongOwner.body?.cancel()
    let page = await k.at('yaks.app', link, {
      headers: { cookie: them.cookie },
    })
    assertEquals(page.status, 200)
    assertStringIncludes(await page.text(), 'retired Room')
    assertEquals(deletions, 0)
    let wrong = await post(them.cookie, { confirm: 'wrong' })
    assertEquals(wrong.status, 400)
    await wrong.body?.cancel()
    assertEquals(deletions, 0)

    // A later migration makes the earlier ticket stale. Redeployment issues
    // a fresh immutable request for the same archived namespace.
    let old = deployed.retirement
    tag = 'v4'
    let stale = await post(them.cookie, { confirm: 'notes' })
    assertStringIncludes(await stale.text(), 'No storage was deleted')
    assertEquals(deletions, 0)
    let latest = await retirementRequested(env, app, script, {
      retired: [],
      archives: [saved],
      tag,
    })
    assert(latest && latest.eid != old.eid)
    await retirementLetter(env, k.dir, space, latest)
    await k.settled()
    let latestLetter = letters(k, them.email).findLast((l) =>
      l.subject.includes('retired storage')
    )!
    let latestLink =
      /https:\/\/yaks\.app(\/space\/\S+)/.exec(latestLetter.body)![1]
    path = `/space/${slug}/confirm/storage/${latest.eid}`
    let confirmed = await post(them.cookie, {
      t: new URL(latestLink, 'https://yaks.app').searchParams.get('t')!,
    })
    assertEquals(confirmed.status, 200)
    assertStringIncludes(await confirmed.text(), 'storage is erased')
    assertEquals(deletions, 1)
    assertEquals(namespaces.has(saved), false)
    assertEquals(namespaces.get('Room'), 'new data')
    assert(
      !(await modules.get('__yak_entry.js')!.text()).includes(
        `export class ${saved}`,
      ),
    )
    let again = await post(them.cookie, { confirm: 'notes' })
    assertEquals(again.status, 404)
    await again.body?.cancel()
    assertEquals(deletions, 1)
  } finally {
    globalThis.fetch = was
  }
})
