// A kept page's client reaches the door over HTTP and a hibernating socket.
import { assert, assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { browser, client, connector, relay, seed, workerd } from './probe.ts'

test('a kept page speaks its vocabulary on writes, queries and socket pushes', async () => {
  let k = workerd()
  let slug = `lens${crypto.randomUUID().slice(0, 6)}`
  let app = 'recipes'
  let host = `${slug}.yaks.app`
  let them = await seed(k, [{ slug, apps: [app] }])
  let agent = connector(k, them.cookie)
  let files = client(k, host, app, them.cookie)
  let mine = browser(k, host, them.cookie)
  let wire = await relay(k, host, them.cookie, `https://${host}`)
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-lens-page-' })
  let stop: (() => void) | undefined
  let document = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    let old = {
      $defs: { recipe: { properties: { title: { type: 'string' } } } },
    }
    await files.put('/index.html', '<!doctype html><h1>Recipes</h1>')
    await files.put('/vocab.json', JSON.stringify(old))
    await agent.tool('app_deploy', { space: slug, app })
    let html = await (await k.at(host, `/${app}/`)).text()
    let version = /api\/release.js" data-version="([0-9]+)"/.exec(html)?.[1]
    assert(version)
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { querySelector: () => ({ dataset: { version } }) },
    })
    let source = await (await k.at(host, `/${app}/api/client.js`)).text()
    Deno.writeTextFileSync(`${dir}/client.js`, source)
    let { store } = await import(`file://${dir}/client.js`)
    let page = store(`${mine.origin}/${app}/api/`)
    let live = store(`${wire.origin}/${app}/api/`)

    await files.put(
      '/vocab.json',
      JSON.stringify({
        $defs: {
          recipe: { properties: {} },
          titles: {
            lens: true,
            step: 0,
            ops: [{ rename: { from: 'recipe.title', to: 'doc.title' } }],
          },
        },
      }),
    )
    await agent.tool('app_deploy', { space: slug, app })
    await page.apply({
      entity: { eid: '$cake' },
      recipe: { title: 'Lemon cake' },
    })
    let [oldView] = await page.query('.recipe.title~=cake')
    assertEquals(oldView.recipe.title, 'Lemon cake')
    let [current] = await files.get('.recipe&?doc')
    assertEquals((current.doc as { title: string }).title, 'Lemon cake')
    assertEquals((current.recipe as { title: null }).title, null)

    let seen: { recipe: { title: string } }[][] = []
    stop = live.subscribe(
      '.recipe.title~=cake',
      (rows: typeof seen[number]) => seen.push(rows),
    )
    await until(() => seen.at(-1)?.[0]?.recipe.title == 'Lemon cake', {
      timeout: 15_000,
    })
    await files.applied([{
      entity: current.entity,
      doc: { title: 'Lime cake' },
    }])
    await until(() => seen.at(-1)?.[0]?.recipe.title == 'Lime cake', {
      timeout: 15_000,
    })
    assertEquals(
      (await page.query('.recipe.title~=cake'))[0].recipe.title,
      'Lime cake',
    )
  } finally {
    stop?.()
    if (document) Object.defineProperty(globalThis, 'document', document)
    else Reflect.deleteProperty(globalThis, 'document')
    await mine.stop()
    await wire.stop()
    Deno.removeSync(dir, { recursive: true })
    await agent.tool('app_delete', { space: slug, app, forever: true })
    await agent.tool('space_delete', { space: slug, forever: true })
  }
})
