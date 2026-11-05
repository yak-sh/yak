// The page's graph, story and prompt, run in this process as the page runs
// them in a tab.
import { equal, match, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { yak } from './yak.ts'
import { LIVE, term } from './term.ts'
import {
  FILES,
  files,
  HERO,
  scriptOf,
  SECTIONS,
  seed,
  SELF,
  SITE,
} from './site.ts'

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
    ['Add the sign-up page', 'done'],
    ['Sign up for payments', 'open'],
    ['Build the checkout', 'open'],
  ])
  let [account] = await y.graph.read('.doc.title="Sign up for payments" *')
  equal(at(account, 'filed.assignee'), y.you)
  equal((await y.graph.read('.requires .edge')).length, 1)
  let [comment] = await y.graph.read('.comment *')
  equal(at(comment, 'created.by'), y.agent)
  match(printed(t), /T-3 Sign up for payments open/)
  equal(at(y.row(SELF), 'doc.title'), 'This page is a graph you can change')
})

test('a step reached twice runs once, and steps reached at once run in order', async () => {
  let { y, t } = await page()
  t.reach(steps, 2)
  t.reach(steps, 1)
  await t.reach(steps, 2)
  equal((await y.graph.read('.task')).length, 3)
})

test("a step's commands run one at a time as each is reached, each under its comment", async () => {
  let { y, t } = await page()
  await t.reach(steps, 2, 1)
  equal((await y.graph.read('.task')).length, 2)
  let run = [...scriptOf(steps[0]), scriptOf(steps[1])[0]]
  equal(
    t.lines().filter((l) => l.kind == 'note' || l.kind == 'in')
      .map((l) => l.text),
    run.flatMap((c) => [`# ${c.note}`, c.line]),
  )
  await t.reach(steps, 2)
  equal((await y.graph.read('.task')).length, 3)
})

test('the prompt keeps up with a reader who scrolls ahead: lines they have passed are typed at once', async () => {
  let y = await yak()
  await y.graph.apply(seed())
  let t = term(y, { key: 1, pause: 0 })
  let typed = new Set<string>()
  t.listen(() => void (t.typing() && typed.add(t.typing())))
  await t.reach(steps, 2)
  let run = [...scriptOf(steps[0]), ...scriptOf(steps[1])].map((c) => c.line)
  equal(t.lines().filter((l) => l.kind == 'in').map((l) => l.text), run)
  let last = run.at(-1)!
  equal([...typed], [...last].map((_, i) => last.slice(0, i + 1)))
})

test('a command the page measures runs as its share of the scrolling starts, and is typed as far as the reader has played it', async () => {
  let { y, t } = await page()
  let [first] = scriptOf(steps[0])
  t.scroll([.5])
  let done = t.reach(steps, 1)
  for (let i = 0; i < 500 && !y.rows().some((b) => b.task); i++) {
    await new Promise((ok) => setTimeout(ok, 1))
  }
  equal(t.typing(), first.line.slice(0, Math.ceil(first.line.length / 2)))
  equal(t.lines().filter((l) => l.kind == 'in'), [])
  t.scroll([1])
  await done
  equal(t.lines().filter((l) => l.kind == 'in').map((l) => l.text), [
    first.line,
  ])
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
    .filter((n) => !n.endsWith('_test.ts') && n != 'package.json').sort()
  equal([...FILES].sort(), served)
  let asked: string[] = []
  let read = await files((path) => {
    asked.push(path)
    return fetch(new URL(path, dir))
  })
  let index = read.find((b) => at(b, 'file.path') == 'index.html')
  equal(at(index, 'file.root'), SITE)
  match(String(at(index, 'content.body')), /<html/)
  let og = read.find((b) => at(b, 'file.path') == 'og.jpg')
  equal([asked.includes('og.jpg'), at(og, 'content')], [false, undefined])
})

test("a pasted link's preview is a file the app serves, on the page's paper", async () => {
  let dir = new URL('./', import.meta.url)
  let { document } = parseHTML(
    await Deno.readTextFile(new URL('index.html', dir)),
  )
  let meta = (key: string) =>
    document.querySelector(`meta[property="${key}"], meta[name="${key}"]`)
      ?.getAttribute('content')
  let css = await Deno.readTextFile(new URL('gouache.css', dir))
  equal(meta('theme-color'), /--bg:\s*light-dark\(([^,]+),/.exec(css)?.[1])
  let image = new URL(meta('og:image') ?? '').pathname.slice(1)
  let icon = document.querySelector('link[rel="icon"]')?.getAttribute('href')
  equal([FILES.includes(image), FILES.includes(icon ?? '')], [true, true])
})
