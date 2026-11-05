// The page drawn from its graph in a LinkeDOM document, as a tab draws it:
// the story typed into the prompt, the drawing following the graph, and a
// section changed from the prompt redrawn in place.
import { equal, match, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { start } from './page.ts'
import { SECTIONS, SELF, SITE } from './site.ts'
import { fileOf } from '@yaks/file'
import { STORY } from './figure.ts'

let dir = new URL('./', import.meta.url)
let open = async () => {
  let window = parseHTML(await Deno.readTextFile(new URL('index.html', dir)))
  let { document } = window
  Object.defineProperty(document, 'baseURI', { value: dir.href })
  Object.assign(globalThis, { document })
  let root = document.querySelector('#page')!
  let page = await start(root, {
    fetch: (path) => fetch(new URL(path, dir)),
    load: () => import('./views.ts'),
    pace: { key: 0, pause: 0 },
  })
  let settle = async () => {
    await page.term.idle()
    await page.yak.settled()
    await new Promise((ok) => setTimeout(ok, 30))
  }
  return { document, root, page, settle }
}
// Each element under `root` as its path of tags and classes, and a leaf's
// words, so two pages can be compared by what they show.
let outline = (root: Element) => {
  let lines: string[] = []
  let walk = (el: Element, at: string) => {
    for (let c of el.children) {
      let path = `${at}>${c.localName}.${c.getAttribute('class') ?? ''}`
      lines.push(
        c.children.length || !c.textContent ? path : `${path} ${c.textContent}`,
      )
      walk(c, path)
    }
  }
  walk(root, '')
  return lines
}

test('the page paints in its drawn layout before its scripts run', async () => {
  let shell = parseHTML(await Deno.readTextFile(new URL('index.html', dir)))
  let before = outline(shell.document.querySelector('#page')!)
  let { root, page } = await open()
  let after = new Set(outline(root))
  equal(before.filter((l) => !after.has(l)), [])
  page.page.close()
})

let steps = SECTIONS.filter((s) => s.view == 'Step').map((s) => s.body)

test('the page draws every section from the graph, in its layout order', async () => {
  let { root, page } = await open()
  equal(root.querySelector('h1')?.textContent, SECTIONS[0].title)
  let drawn = [...root.querySelectorAll('[data-eid]')]
    .map((el) => el.getAttribute('data-eid'))
    .filter((eid) => SECTIONS.some((s) => s.eid == eid))
  equal(drawn, SECTIONS.map((s) => s.eid))
  page.page.close()
})

test('the story types into the prompt and the drawing draws what it made', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, 4)
  await settle()
  let screen = root.querySelector('.Prompt_Screen')!.textContent!
  match(screen, /\$ yak task new 'Throw the party'/)
  match(screen, /agent ▸ task_update/)
  let sheet = root.querySelector('.Figure_Sheet')!.innerHTML
  for (let id of ['U-1', 'T-2', 'T-3', 'N-4', 'C-5']) {
    match(sheet, new RegExp(`>${id}<`))
  }
  match(sheet, />Buy the cake</)
  match(sheet, /data-name="requires"/)
  match(sheet, /data-name="completed.by"/)
  let doors = root.querySelector('.Doors_Draw')!
  equal(doors.getAttribute('data-door'), 'agent')
  equal(
    [...doors.querySelectorAll('.N .id')].map((t) => t.textContent),
    ['U-1', 'T-2 open', 'T-3 done', 'C-5'],
  )
  page.page.close()
})

test('a section changed from the prompt redraws in place, and the drawing keeps to the demo', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, steps.length)
  await settle()
  let heading = root.querySelector(`[data-eid="${SELF}"] h2`)?.textContent
  equal(heading, 'This page is a graph you can change')
  equal(page.figure.query(), STORY)
  let sheet = () => root.querySelector('.Figure_Sheet')!.innerHTML
  equal(sheet().includes('>index.html<'), false)
  let files = [...root.querySelectorAll('.Figure_Wider button')]
    .find((b) => b.textContent == "the site's files") as unknown as {
      click: () => void
    }
  files.click()
  await settle()
  match(sheet(), />index.html</)
  page.page.close()
})

test('the start draws at once, and each step only as far as it is scrolled into', async () => {
  let { page, settle } = await open()
  await page.term.reach(steps, 4)
  await settle()
  let at = (n: number) => page.figure.reached(n, performance.now() + 5000)
  equal([at(0), at(1), at(3)], [1, 0, 0])
  page.figure.scroll([1, .5])
  equal([at(1), at(2), at(3)], [1, .5, 0])
})

test('the drawing widened and back to the demo still draws each step as far as it is scrolled', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, 4)
  await settle()
  let wider = (name: string) =>
    ([...root.querySelectorAll('.Figure_Wider button')]
      .find((b) => b.textContent == name) as unknown as { click: () => void })
      .click()
  wider("the site's files")
  await settle()
  wider('the demo')
  await settle()
  let at = (n: number) => page.figure.reached(n, performance.now() + 5000)
  page.figure.scroll([1, .5])
  equal([at(1), at(2), at(3)], [1, .5, 0])
  page.page.close()
})

// Fire `type` on `el` the way a reader's browser does: bubbling up from it.
let { Event: Dom } = parseHTML('<html></html>')
let fire = (el: Element, type: string) =>
  el.dispatchEvent(new Dom(type, { bubbles: true }))

test('an entity clicked in the drawing opens in the editor, and a value changed there is typed into the prompt', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, 3)
  await settle()
  let cake = page.yak.rows().find((b) =>
    (b.doc as { title?: string })?.title == 'Buy the cake'
  )!
  fire(
    root.querySelector(`.Figure_Sheet [data-eid="${cake.entity.eid}"] text`)!,
    'click',
  )
  await settle()
  let editor = () => root.querySelector('.Editor')!
  equal(editor().querySelector('.Editor_Bar b')?.textContent, 'T-3')
  match(editor().textContent!, /doc\{title, body\}/)
  let screen = () => root.querySelector('.Prompt_Screen')!.textContent!
  match(screen(), /\$ graph show T-3/)
  let title = editor().querySelector(
    '[aria-label="doc.title"]',
  ) as unknown as HTMLInputElement
  title.value = 'Buy Ada\'s "cake"'
  fire(title as unknown as Element, 'input')
  fire(title as unknown as Element, 'blur')
  await settle()
  equal(
    (page.yak.row(cake.entity.eid)!.doc as { title: string }).title,
    `Buy Ada's "cake"`,
  )
  match(screen(), /\$ graph apply T-3 /)
  let id = [...root.querySelectorAll('.Prompt_Id')].find((b) =>
    b.textContent == 'T-2'
  )!
  fire(id, 'click')
  await settle()
  equal(editor().querySelector('.Editor_Bar b')?.textContent, 'T-2')
  fire(editor().querySelector('.Editor_Bar button')!, 'click')
  await settle()
  equal(root.querySelector('.Editor'), null)
  let opened = async (el: Element) => {
    fire(el, 'click')
    await settle()
    return editor().querySelector('.Editor_Bar b')?.textContent
  }
  equal(await opened(root.querySelector('#door-agent')!), 'N-4')
  equal(await opened(root.querySelector('.Doors_Draw .N-task')!), 'T-2')
  equal(await opened(root.querySelector('.Stack_Draw .pl')!), 'T-3')
  page.page.close()
})

test("a change to the graph's style.css restyles the page", async () => {
  let { document, page, settle } = await open()
  let sheet = fileOf(SITE, 'style.css')
  await page.yak.graph.apply([{
    entity: { eid: sheet },
    content: { body: 'body { color: red }' },
  }])
  await settle()
  equal(
    document.querySelector('style[data-site]')?.textContent,
    'body { color: red }',
  )
  equal(document.querySelector('link[href="style.css"]'), null)
  page.page.close()
})

test('the stack shows the last entity written and the phases apply() ran', async () => {
  let { root, page, settle } = await open()
  await page.term.enter("task new 'Water the plants'")
  await settle()
  let plates = [...root.querySelectorAll('.pl')].map((p) =>
    p.getAttribute('data-pl')
  )
  equal(plates, ['entity', 'doc', 'task', 'created'])
  let phases = (state: string) =>
    [...root.querySelectorAll(`.Phases li.${state}`)].map((p) =>
      p.getAttribute('data-phase')
    )
  equal(
    phases('on').includes('commit') && phases('on').includes('rules'),
    true,
  )
  equal(phases('skip'), ['audit'])
  page.page.close()
})
