// The page's graph, story and prompt, run in this process as the page runs
// them in a tab.
import { equal, match, test } from '@yaks/testing'
import { yak } from './yak.ts'
import { LIVE, term } from './term.ts'
import { FILES, files, HERO, SECTIONS, seed, SELF, SITE } from './site.ts'

let page = async () => {
  let y = await yak()
  await y.graph.apply(seed())
  await y.settled()
  return { y, t: term(y) }
}
// One property of a bundle, `comp.prop`.
let at = (b: unknown, path: string): unknown =>
  path.split('.').reduce(
    (v, k) => (v as Record<string, unknown> | undefined)?.[k],
    b,
  )
let printed = (t: ReturnType<typeof term>) =>
  t.lines().map((l) => l.text).join('\n')
let steps = SECTIONS.filter((s) => s.view == 'Step').map((s) => s.body)

test('the site is entities: a layout, a pane per section in order, its docs', async () => {
  let { y } = await page()
  let panes = y.rows().filter((b) => at(b, 'pane.parent'))
    .sort((a, b) => Number(at(a, 'pane.order')) - Number(at(b, 'pane.order')))
  equal(panes.map((p) => at(p, 'pane.content')), SECTIONS.map((s) => s.eid))
  let root = y.rows().find((b) => b.pane && !at(b, 'pane.parent'))
  equal(at(y.row(SITE), 'layout.root'), root?.entity.eid)
  equal(at(y.row(HERO), 'doc.title'), SECTIONS[0].title)
})

test('the story runs every step in order, typed and called, and the graph holds what it says', async () => {
  let { y, t } = await page()
  await t.reach(steps, steps.length)
  equal(t.lines().filter((l) => l.kind == 'fault'), [])
  let tasks = await y.graph.read('.task ?doc')
  equal(tasks.map((b) => [at(b, 'doc.title'), at(b, 'task.status')]), [
    ['Throw the party', 'open'],
    ['Buy the cake', 'done'],
  ])
  equal((await y.graph.read('.requires .edge')).length, 1)
  let [comment] = await y.graph.read('.comment *')
  equal(at(comment, 'created.by'), y.agent)
  match(printed(t), /T-2 Throw the party open/)
  equal(at(y.row(SELF), 'doc.title'), 'This page is a graph you can change')
})

test('a step reached twice runs once, and steps reached at once run in order', async () => {
  let { y, t } = await page()
  t.reach(steps, 2)
  t.reach(steps, 1)
  await t.reach(steps, 2)
  equal((await y.graph.read('.task')).length, 2)
})

test('a visitor types into the same prompt: help, a refusal, a write the page sees', async () => {
  let { y, t } = await page()
  await t.enter('help')
  match(printed(t), /task new/)
  await t.enter('nope')
  equal(t.lines().at(-1), { kind: 'fault', text: 'yak: no command nope' })
  let told = 0
  y.watch(HERO, () => told++)
  await t.enter(`graph apply ${HERO} .doc.title=Hi`)
  equal([at(y.row(HERO), 'doc.title'), told], ['Hi', 1])
  equal(t.history(), ['help', 'nope', `graph apply ${HERO} .doc.title=Hi`])
  equal(t.stage(), LIVE + 2)
})

test('every file the app serves is a file read in the site, text with its contents', async () => {
  let dir = new URL('./', import.meta.url)
  let served = [...Deno.readDirSync(dir)].map((e) => e.name)
    .filter((n) => !n.endsWith('_test.ts')).sort()
  equal([...FILES].sort(), served)
  let read = await files((path) => fetch(new URL(path, dir)))
  let index = read.find((b) => at(b, 'file.path') == 'index.html')
  equal(at(index, 'file.root'), SITE)
  match(String(at(index, 'content.body')), /<html/)
})
