// A page keeps its deploy identity while the store advances and code rolls back.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { client, connector, kernel, seed } from './probe.ts'

let old = {
  $defs: { recipe: { properties: { title: { type: 'string' } } } },
}
let first = {
  $defs: {
    recipe: { properties: { heading: { type: 'string' } } },
    title_step: {
      lens: true,
      step: 20261003140000,
      ops: [{ rename: { from: 'recipe.title', to: 'recipe.heading' } }],
    },
  },
}
let latest = {
  $defs: {
    ...first.$defs,
    recipe: { properties: {} },
    heading_step: {
      lens: true,
      step: 20261004102000,
      ops: [{ rename: { from: 'recipe.heading', to: 'doc.title' } }],
    },
  },
}

test('kept deploys speak timestamp suffixes through HTTP and code rollback', async () => {
  let k = await kernel()
  let slug = `lens${crypto.randomUUID().slice(0, 8)}`
  let app = 'recipes'
  let host = `${slug}.yaks.app`
  let them = await seed(k, [{ slug, apps: [app] }])
  let agent = connector(k, them.cookie)
  let files = client(k, host, app, them.cookie)
  let at = { space: slug, app }
  let deploy = async (doc: unknown) => {
    await files.put('/vocab.json', JSON.stringify(doc))
    await agent.tool('app_deploy', at)
  }
  let page = (version: number) => {
    let headers = { cookie: them.cookie, 'x-yak-version': String(version) }
    return {
      apply: async (row: unknown) => {
        let r = await k.at(host, `/${app}/api/apply`, {
          method: 'POST',
          headers,
          body: JSON.stringify([row]),
        })
        assertEquals(r.status, 200, await r.text())
      },
      query: async (q: string) => {
        let r = await k.at(
          host,
          `/${app}/api/query?q=${encodeURIComponent(q)}`,
          { headers },
        )
        assertEquals(r.status, 200)
        return r.json()
      },
    }
  }
  try {
    await files.put('/index.html', '<!doctype html><h1>Recipes</h1>')
    await deploy(old)
    await deploy(first)
    await deploy(latest)
    let entity = { eid: crypto.randomUUID() }
    await page(1).apply({ entity, recipe: { title: 'Cake' } })
    assertEquals(
      (await page(1).query('.recipe.title~=Cake'))[0].recipe.title,
      'Cake',
    )
    assertEquals(
      (await page(2).query('.recipe.heading~=Cake'))[0].recipe.heading,
      'Cake',
    )
    assertEquals(
      ((await files.get('.recipe ?doc'))[0].doc as { title: string }).title,
      'Cake',
    )
    await agent.tool('app_rollback', { ...at, version: 1 })
    await page(1).apply({ entity, recipe: { title: 'Cake again' } })
    assertEquals(
      (await page(1).query('.recipe.title~=again'))[0].recipe.title,
      'Cake again',
    )
    assertEquals(
      (await page(3).query('.recipe ?doc'))[0].doc.title,
      'Cake again',
    )
  } finally {
    await agent.tool('app_delete', { ...at, forever: true })
    await agent.tool('space_delete', { space: slug, forever: true })
  }
})
