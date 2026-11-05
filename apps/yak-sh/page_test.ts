// The page drawn from its graph in a LinkeDOM document, as a tab draws it:
// the story typed into the prompt, the drawing following the graph, and a
// section changed from the prompt redrawn in place.
import { equal, match, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { start } from './page.ts'
import { SECTIONS, SELF } from './site.ts'

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
  match(sheet, />T-1</)
  match(sheet, />Buy the cake</)
  match(sheet, /data-name="requires"/)
  equal(
    root.querySelector('.Doors .is-open')?.className.includes('is-agent'),
    true,
  )
  page.page.close()
})

test('a section changed from the prompt redraws in place, and the drawing takes its query', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, steps.length)
  await settle()
  let heading = root.querySelector(`[data-eid="${SELF}"] h2`)?.textContent
  equal(heading, 'This page is a graph you can change')
  equal(page.figure.query(), '.file|.pane|.layout *')
  match(root.querySelector('.Figure_Sheet')!.innerHTML, />index.html</)
  page.page.close()
})

test('the stack shows the last entity written and the phases apply() ran', async () => {
  let { root, page, settle } = await open()
  await page.term.enter("task new 'Water the plants'")
  await settle()
  let plates = [...root.querySelectorAll('.Plate b')].map((b) => b.textContent)
  equal(plates.includes('task') && plates.includes('doc'), true)
  let lit = [...root.querySelectorAll('.Phase.is-lit')].map((p) =>
    p.textContent
  )
  equal(lit.includes('commit') && lit.includes('rules'), true)
  page.page.close()
})
