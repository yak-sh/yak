// The page drawn from its graph in a LinkeDOM document, as a tab draws it:
// the story typed into the prompt, the drawing following the graph, and a
// section changed from the prompt redrawn in place.
import { equal, match, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { start } from './page.ts'
import { beatsOf, scriptOf, SECTIONS, SELF, SITE } from './site.ts'
import { text } from './told.ts'
import { fileOf } from '@yaks/file'
import { STORY } from './figure.ts'
import { SHOP, YOURS } from './shop.ts'
import { INSIDE, PHASES } from '@yaks/graph/plugin'

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
    retry: 0,
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
  match(screen, /\$ yak task new 'Add the sign-up page'/)
  match(screen, /agent ▸ task_update/)
  let sheet = root.querySelector('.Figure_Sheet')!.innerHTML
  for (let id of ['U-1', 'T-2', 'T-3', 'T-4', 'N-5', 'C-6']) {
    match(sheet, new RegExp(`>${id}<`))
  }
  match(sheet, />Build the checkout</)
  match(sheet, /data-name="requires"/)
  match(sheet, /data-name="filed.assignee"/)
  match(sheet, /data-name="completed.by"/)
  page.page.close()
})

test('each interface in the doors band makes its own change to the one graph, drawn as the top draws it', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, steps.length)
  let band = SECTIONS.find((s) => s.view == 'Doors')!
  await page.turns.reach(band.eid, beatsOf(band.body).beats.length)
  await settle()
  let { you, agent } = page.yak
  let task = async (title: string) =>
    (await page.yak.graph.read(`.doc.title="${title}" *`))[0]
  let paid = await task('Sign up for payments')
  let checkout = await task('Build the checkout')
  let fix = await task('Fix the failing build')
  equal([
    [text(paid, 'task', 'status'), text(paid, 'completed', 'by')],
    [text(checkout, 'task', 'status'), text(checkout, 'completed', 'by')],
    [text(fix, 'task', 'status'), text(fix, 'filed', 'assignee')],
  ], [['done', you], ['done', agent], ['open', agent]])
  let doors = root.querySelector(`[data-eid="${band.eid}"]`)!
  equal(
    [...doors.querySelectorAll('.Window')].map((w) =>
      w.getAttribute('data-door')
    ),
    ['web', 'mcp', 'sh'],
  )
  let shown = doors.querySelector('.Window.is-open')!
  match(shown.textContent!, /T-7 Fix the failing build open/)
  // The band draws what the top draws, and marks what the open window wrote.
  let drawn = (in_: Element, sel: string) =>
    [...in_.querySelectorAll(`${sel} .Diagram_Node`)]
      .map((n) => n.getAttribute('transform'))
  equal(drawn(doors, '.Doors_Drawing'), drawn(root, '.Figure_Sheet'))
  equal(
    doors.querySelector('.Doors_Drawing .is-told')?.getAttribute('data-key'),
    fix.entity.eid,
  )
  equal(!!doors.querySelector('.Doors_Wire path'), true)
  fire(doors.querySelector('.Window[data-door="mcp"]')!, 'click')
  await settle()
  equal(root.querySelector('.Editor .Editor_Bar b')?.textContent, 'N-5')
  page.page.close()
})

test('in the rules band a rule makes a question a letter, an effect sends it, and a rule closes the question once answered', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, steps.length)
  let band = SECTIONS.find((s) => s.view == 'Rules')!
  let rules = root.querySelector(`[data-eid="${band.eid}"]`)!
  let reach = async (n: number) => {
    await page.turns.reach(band.eid, n)
    await settle()
    let open = rules.querySelector('.Window.is-open')!
    return {
      door: open.getAttribute('data-door'),
      said: open.textContent!,
      declared: [...rules.querySelectorAll('.Declared')]
        .map((d) => d.getAttribute('data-declared')),
      told: rules.querySelector('.is-told')?.getAttribute('data-key'),
      toast: rules.querySelector('.Toast')?.textContent,
    }
  }
  let asked = await reach(1)
  // The bands above ran first, so the build's fix is T-7 and this is T-8.
  match(asked.said, /T-8 Which payments key should the build use\? open/)
  equal(asked.declared, ['question_mail', 'letter_from'])
  let [letter] = await page.yak.graph.read('.mail.target.decision *')
  equal(
    [text(letter, 'mail', 'from'), text(letter, 'mail', 'to')],
    [SHOP, YOURS],
  )
  let sent = await reach(2)
  equal([sent.door, sent.declared, sent.told], [
    'outbox',
    ['mail_post'],
    letter.entity.eid,
  ])
  match(sent.said, /turned away: .*taken as outbox-\d/)
  equal(sent.toast, `Email sent to ${YOURS}${text(letter, 'doc', 'title')}`)
  let closed = await reach(3)
  equal([closed.door, closed.declared, closed.toast], [
    'web',
    ['decision_answered'],
    undefined,
  ])
  let [question] = await page.yak.graph.read('.decision *')
  equal(
    [text(question, 'task', 'status'), text(question, 'decided', 'choice')],
    ['done', 'The test key'],
  )
  page.page.close()
})

test("in the memory band your words become a memory your agent's persona carries, and a new session starts with them", async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, steps.length)
  let band = SECTIONS.find((s) => s.view == 'Memory')!
  await page.turns.reach(band.eid, beatsOf(band.body).beats.length)
  await settle()
  let said = 'Never put the live key in CI: it charges real cards.'
  let [kept] = await page.yak.graph.read('.memory *')
  equal(
    [text(kept, 'doc', 'body'), text(kept, 'created', 'by')],
    [said, page.yak.you],
  )
  let memory = root.querySelector(`[data-eid="${band.eid}"]`)!
  equal(
    [...memory.querySelectorAll('.Window')].map((w) =>
      w.getAttribute('data-door')
    ),
    ['web', 'mcp', 'mcp', 'session'],
  )
  let started = memory.querySelector('.Window.is-open')!
  match(started.textContent!, /wears N-5# N-5 Your agent.*# C-9/)
  match(started.textContent!, new RegExp(said))
  equal(
    memory.querySelector('.is-told')?.getAttribute('data-key'),
    page.yak.agent,
  )
  page.page.close()
})

test('each thing the story draws leads back to the command whose write made it', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, 3)
  await settle()
  let drawn = (sel: string) =>
    root.querySelector(`.Figure_Sheet ${sel}`)!.getAttribute('data-key')!
  // The command that made a drawn thing, as its step lists it.
  let madeBy = (key: string) => {
    let at = page.figure.madeBy(key)!
    let { sh, mcp } = scriptOf(steps[at.stage - 1])
    return [...sh, ...mcp.map((m) => m.tool)][at.line]
  }
  let titled = (title: string) =>
    page.yak.rows().find((b) => (b.doc as { title?: string })?.title == title)!
      .entity.eid
  let [account, checkout, edge] = scriptOf(steps[1]).sh
  equal([
    madeBy(titled('Sign up for payments')),
    madeBy(drawn('[data-name="filed.assignee"]')),
    madeBy(titled('Build the checkout')),
    madeBy(drawn('[data-name="requires"]')),
    madeBy(drawn('[data-name="comment.target"]')),
    madeBy(drawn('[data-name="completed.by"]')),
  ], [account, account, checkout, edge, 'comment_new', 'task_update'])
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
  let account = page.yak.rows().find((b) =>
    (b.doc as { title?: string })?.title == 'Sign up for payments'
  )!
  fire(
    root.querySelector(
      `.Figure_Sheet [data-eid="${account.entity.eid}"] text`,
    )!,
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
  title.value = 'Sign up for Ada\'s "payments"'
  fire(title as unknown as Element, 'input')
  fire(title as unknown as Element, 'blur')
  await settle()
  equal(
    (page.yak.row(account.entity.eid)!.doc as { title: string }).title,
    `Sign up for Ada's "payments"`,
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
  equal(
    await opened(root.querySelector('.Doors_Drawing .Diagram_Node text')!),
    'U-1',
  )
  equal(await opened(root.querySelector('.Source .R[data-row] .c')!), 'T-3')
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

test('the apply() band sends its letter as the source of its bundle, beside the phases it ran, and its effect delivers it', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, steps.length)
  let band = SECTIONS.find((s) => s.view == 'Stack')!
  await page.term.once(band.eid, band.body)
  await settle()
  let stack = root.querySelector('.Stack')!
  let rows = [...stack.querySelectorAll('.Source [data-row]')].map((p) =>
    p.getAttribute('data-row')
  )
  equal(rows, ['entity', 'deliver', 'doc', 'mail', 'delivered', 'created'])
  let source = stack.querySelector('.Source')!.textContent!
  match(source, /title: "Can you sign up for payments\?"/)
  match(source, /from: "hello@example.com"/)
  match(source, /message_id: "outbox-1"/)
  match(stack.querySelector('.Call')!.textContent!, /agent ▸ graph_apply/)
  equal(
    [...stack.querySelectorAll('.Outbox li')].map((l) => l.className),
    ['is-refused', 'is-taken'],
  )
  match(stack.querySelector('.Outbox')!.textContent!, /taken as outbox-1/)
  equal(
    stack.querySelector('.Toast')?.textContent,
    'Email sent to you@example.comCan you sign up for payments?',
  )
  let phases = (state: string) =>
    [...stack.querySelectorAll(`.Phases li.${state}`)].map((p) =>
      p.getAttribute('data-phase')
    )
  equal(
    phases('on').includes('commit') && phases('on').includes('rules'),
    true,
  )
  equal(phases('skip'), ['audit'])
  let named = (sel: string) =>
    [...stack.querySelectorAll(sel)].map((p) => p.getAttribute('data-phase'))
  equal(named('.Phases [data-phase]'), PHASES)
  equal(named('.Phases .Tx [data-phase]'), INSIDE)
  // A write the visitor types is the band's next.
  await page.term.enter("task new 'Water the plants'")
  await settle()
  equal(
    [...stack.querySelectorAll('.Source [data-row]')].map((p) =>
      p.getAttribute('data-row')
    ),
    ['entity', 'doc', 'task', 'created'],
  )
  match(
    stack.querySelector('.Call')!.textContent!,
    /\$ task new 'Water the plants'/,
  )
  equal(stack.querySelector('.Outbox, .Toast'), null)
  page.page.close()
})
