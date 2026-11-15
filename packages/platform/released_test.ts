// A release directory opens on this machine as the store yaks.app keeps for
// its app, answering through @yaks/api's doors in its own words and the
// renames it declares.
import { equal, test } from '@yaks/testing'
import { packageEid } from '@yaks/lens'
import { opened } from './released.ts'

let dir = new URL('./fixtures/recipes', import.meta.url).pathname
let host = await opened(dir, ['graph', 'web'], { db: ':memory:' })
let door = (path: string, body?: unknown) =>
  Promise.resolve(host.handler!(
    new Request(
      `http://host${path}`,
      body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
    ),
  ))
let headed = async (heading: string) =>
  (await (await door(`/query?q=.recipe.heading=${heading}`)).json())
    .map((row: { recipe: { heading: string } }) => row.recipe.heading)

test('a row in the release’s words is written and read back', async () => {
  await door('/apply', [{
    entity: { eid: 'cake' },
    recipe: { heading: 'Cake' },
  }])
  equal(await headed('Cake'), ['Cake'])
})

test('a write in the release’s first words reads in its declared rename', async () => {
  await door('/apply', [{
    entity: { eid: 'pie' },
    recipe: { title: 'Pie' },
    $speaks: { [packageEid('@app/recipes')]: 0 },
  }])
  equal(await headed('Pie'), ['Pie'])
})
