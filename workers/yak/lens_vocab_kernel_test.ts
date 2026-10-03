import { equal, ok, test } from '@yaks/testing'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { appKeywords } from './vocab.ts'
import { client, connector, kernel, seed } from './probe.ts'

test('kept pages load their vocabulary and compose old reads and writes through a borrowed home', async () => {
  let k = await kernel()
  let slug = `lensv${crypto.randomUUID().slice(0, 8)}`
  let them = await seed(k, [{ slug, apps: ['shelf', 'recipes'] }])
  let agent = connector(k, them.cookie)
  let host = `${slug}.yaks.app`, at = { space: slug, app: 'recipes' }
  let shelf = client(k, host, 'shelf', them.cookie)
  let files = client(k, host, 'recipes', them.cookie)
  let book = { component: true, properties: { pages: { type: 'number' } } }
  let old = {
    $defs: {
      book,
      recipe: { component: true, properties: { title: { type: 'string' } } },
    },
  }
  let next = {
    $defs: {
      book,
      recipe: { component: true, properties: { heading: { type: 'string' } } },
      title_step: {
        lens: true,
        step: 20261003140000,
        ops: [{ rename: { from: 'recipe.title', to: 'recipe.heading' } }],
      },
    },
  }
  let page = async (version: number, path: string, row?: unknown) => {
    let r = await k.at(host, `/recipes/api/${path}`, {
      method: row ? 'POST' : 'GET',
      headers: { cookie: them.cookie, 'x-yak-version': String(version) },
      body: row ? JSON.stringify([row]) : undefined,
    })
    ok(r.ok, await r.clone().text())
    return r.json()
  }
  let checkVocab = async (version: number, field: string, absent: string) => {
    for (let door of ['vocab', 'vocab.json']) {
      let wire = await page(version, door)
      let docs: VocabDoc[] = door == 'vocab' ? wire.docs : wire
      let vocab = loadVocab(docs, appKeywords)
      ok(vocab.prop('recipe', field))
      ok(!vocab.prop('recipe', absent))
      ok(vocab.prop('book', 'pages'))
    }
  }
  try {
    await shelf.put('/index.html', '<h1>Shelf</h1>')
    await shelf.put('/vocab.json', JSON.stringify({ $defs: { book } }))
    await agent.tool('app_deploy', { space: slug, app: 'shelf' })
    await files.put('/index.html', '<h1>Recipes</h1>')
    await files.put('/vocab.json', JSON.stringify(old))
    await agent.tool('app_deploy', at)
    await files.put('/vocab.json', JSON.stringify(next))
    await agent.tool('app_deploy', at)
    await checkVocab(1, 'title', 'heading')
    await checkVocab(2, 'heading', 'title')
    let entity = { eid: crypto.randomUUID() }
    let applied = await page(1, 'apply', {
      entity,
      recipe: { title: 'Cake' },
      book: { pages: 12 },
    })
    equal(
      applied.find((r: { entity: { eid: string } }) =>
        r.entity.eid == entity.eid
      ).recipe,
      { title: 'Cake' },
    )
    let query = (version: number, q: string) =>
      page(version, `query?q=${encodeURIComponent(q)}`)
    equal(
      (await query(1, '.recipe.title~=Cake&.book&.order=recipe.title'))[0]
        .recipe.title,
      'Cake',
    )
    equal(
      (await query(2, '.recipe.heading~=Cake&.book'))[0].recipe.heading,
      'Cake',
    )
    await agent.tool('app_rollback', { ...at, version: 1 })
    await checkVocab(1, 'title', 'heading')
    await checkVocab(2, 'heading', 'title')
    await page(1, 'apply', {
      entity,
      recipe: { title: 'Cake again' },
      book: { pages: 13 },
    })
    equal((await query(1, '.recipe.title~=again&.book'))[0].book.pages, 13)
  } finally {
    await agent.tool('app_delete', { ...at, forever: true })
    await agent.tool('app_delete', { space: slug, app: 'shelf', forever: true })
    await agent.tool('space_delete', { space: slug, forever: true })
  }
})
