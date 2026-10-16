// Exercise the generated browser runtime through the playground's CLI, not a
// second graph fixture. The browser import map pins the CLI parser separately.
import { equal, match, test, throws } from '@yaks/testing'
import { create, words } from './playground.js'

const id = 'c3272ad7-1f5b-475a-b934-cd6d0a15ab41'
const patch = await create()
const explicit = await create()
const cleared = await create()
const removed = await create()
const typed = await create()
const invalid = await create()
const batch = await create()
const queried = await create()
const fresh = await create()
const ignored = () => {}

test('playground keeps quoted bundle JSON in one argument', () => {
  equal(words(`graph apply --bundles '[{"book":{"title":"A long title"}}]'`), [
    'graph',
    'apply',
    '--bundles',
    '[{"book":{"title":"A long title"}}]',
  ])
  equal(words(`graph query ""`), ['graph', 'query', ''])
})

test('playground refuses an unclosed quoted command', () => {
  throws(() => words("graph query '.book"))
})

test('playground patches a book by its leading UUID', async () => {
  equal(await patch.run(`graph apply ${id} .book.pages=500`, ignored), 0)
  equal((await patch.books())[0].book, { title: 'Dune', pages: 500 })
})

test('playground patches a book by explicit entity.eid', async () => {
  equal(
    await explicit.run(
      `graph apply .entity.eid=${id} .book.pages=500`,
      ignored,
    ),
    0,
  )
  equal((await explicit.books())[0].book, { title: 'Dune', pages: 500 })
})

test('playground clears a property without removing its component', async () => {
  equal(await cleared.run(`graph apply ${id} .book.pages=null`, ignored), 0)
  equal((await cleared.books())[0].book, { title: 'Dune', pages: null })
})

test('playground removes a component', async () => {
  equal(await removed.run(`graph apply ${id} !book`, ignored), 0)
  equal(await removed.books(), [])
})

test('playground reads property types from its vocabulary', async () => {
  equal(
    await typed.run(
      `graph apply ${id} .book.title=500 .book.pages=500`,
      ignored,
    ),
    0,
  )
  equal((await typed.books())[0].book, { title: '500', pages: 500 })
})

test('playground refuses an invalid number without changing the book', async () => {
  equal(await invalid.run(`graph apply ${id} .book.pages=oops`, ignored), 1)
  equal((await invalid.books())[0].book, { title: 'Dune', pages: 412 })
})

test('playground still accepts a JSON batch', async () => {
  equal(
    await batch.run(
      `graph apply --bundles '[{"entity":{"eid":"${id}"},"book":{"pages":600}}]'`,
      ignored,
    ),
    0,
  )
  equal((await batch.books())[0].book.pages, 600)
})

test('playground queries the same graph and starts each tab fresh', async () => {
  const output: string[] = []
  equal(
    await queried.run(
      'graph query .book.pages>400',
      (s: string) => output.push(s),
    ),
    0,
  )
  equal(JSON.parse(output.join('')).result[0].book, {
    title: 'Dune',
    pages: 412,
  })
  equal((await fresh.books())[0].book, { title: 'Dune', pages: 412 })
})

const page = await Deno.readTextFile(new URL('./index.html', import.meta.url))
const source = await Deno.readTextFile(
  new URL('./playground.js', import.meta.url),
)

test('site and playground use the same UUID for every book example', () => {
  const seed = source.match(/eid: '([^']+)'/)![1]
  match(
    seed,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  // Hero bundle, patch command, explicit target and initial visible card.
  equal(page.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g), [
    id,
    id,
    id,
    id,
  ])
  equal(seed, id)
  equal(source.includes("eid: '$"), false)
  equal(page.includes('book:dune'), false)
  equal(source.includes('const id = mint()'), true)
})
