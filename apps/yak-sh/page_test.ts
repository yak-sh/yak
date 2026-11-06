// The page drawn from its graph in a LinkeDOM document, as a tab draws it:
// the story typed into the prompt, the drawing following the graph, and a
// section changed from the prompt redrawn in place.
import { cleanup, equal, match, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { start } from './page.ts'
import { beatsOf, scriptOf, SECTIONS, SELF, SITE } from './site.ts'
import { text } from './told.ts'
import { fileOf } from '@yaks/file'
import { STORY } from './figure.ts'
import { SHOP, YOURS } from './shop.ts'
import { inboxAt, rendered } from '@yaks/inbox/letters'
import { INSIDE, PHASES } from '@yaks/graph/plugin'
import { options } from 'preact'

let dir = new URL('./', import.meta.url)
// A tab paints its next frame as soon as it can; preact's hooks wait 35 ms
// for one where there is no requestAnimationFrame.
options.requestAnimationFrame = (fn) => setTimeout(fn)
let tick = () => new Promise((ok) => setTimeout(ok))
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
  // Everything queued has run, and the page has drawn and run its effects.
  let settle = async () => {
    for (let i = 0; i < 3; i++) {
      await page.term.idle()
      await page.yak.settled()
      await tick()
    }
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
let BANDS = SECTIONS.filter((s) =>
  ['Doors', 'Rules', 'Memory'].includes(s.view)
)
let STACK = SECTIONS.find((s) => s.view == 'Stack')!

// The page as a reader leaves it at the bottom: the whole story, the apply()
// band and every band's beats run. Made once, for the tests that look at it;
// none of them changes what another looks at.
let bottom: ReturnType<typeof open> | undefined
let whole = () =>
  bottom ??= open().then(async (opened) => {
    let { page, settle } = opened
    await page.term.reach(steps, steps.length)
    await page.term.once(STACK.eid, STACK.body)
    for (let b of BANDS) {
      await page.turns.reach(b.eid, beatsOf(b.body).beats.length)
    }
    await settle()
    return opened
  })

test('the page draws every section from the graph, in its layout order', async () => {
  let { root } = await whole()
  equal(root.querySelector('h1')?.textContent, SECTIONS[0].title)
  let drawn = [...root.querySelectorAll('[data-eid]')]
    .map((el) => el.getAttribute('data-eid'))
    .filter((eid) => SECTIONS.some((s) => s.eid == eid))
  equal(drawn, SECTIONS.map((s) => s.eid))
})

test('the story types into the prompt and the drawing draws what it made', async () => {
  let { root } = await whole()
  let screen = root.querySelector('.Prompt_Screen')!.textContent!
  match(screen, /\$ yak task new 'Add the sign-up page'/)
  match(screen, /agent → task_update/)
  let sheet = root.querySelector('.Figure_Sheet')!.innerHTML
  for (let id of ['U-1', 'T-2', 'T-3', 'T-4', 'N-5', 'C-6']) {
    match(sheet, new RegExp(`>${id}<`))
  }
  match(sheet, />Build the checkout</)
  match(sheet, /data-name="requires"/)
  match(sheet, /data-name="filed.assignee"/)
  match(sheet, /data-name="completed.by"/)
})

test('each interface in the doors band makes its own change to the one graph, drawn as the top draws it', async () => {
  let { root, page, settle } = await whole()
  let band = SECTIONS.find((s) => s.view == 'Doors')!
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
  let shown = doors.querySelector('.Window.is-last')!
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
  fire(root.querySelector('.Editor .Editor_Bar button')!, 'click')
  await settle()
})

test("a band's call that fails is reported, for the tracker", async () => {
  let { page } = await whole()
  // Heard at reportError, where the tracker's page reporter hears it: the
  // test runner's own error listener counts every error event as uncaught.
  let heard: string[] = []
  let report = globalThis.reportError
  globalThis.reportError = (e) => heard.push(String((e as Error).message))
  cleanup(() => globalThis.reportError = report)
  await page.term.reach(steps, steps.length)
  page.turns.band('lost', [{
    title: 'Lost',
    prose: '',
    kind: 'mcp',
    line: 'task_update {"task": "T-99", "status": "done"}',
    shows: [],
  }])
  await page.turns.reach('lost', 1)
  match(heard.join(), /yak\.sh: task_update .*T-99.* failed: .*T-99/)
})

test('in the rules band your inbox writes a question that holds up the build as a letter, an effect hands it over and tries again on its own when the mail service refuses it, and your reply is a comment that answers it', async () => {
  let { root, page, settle } = await open()
  await page.term.reach(steps, steps.length)
  let band = SECTIONS.find((s) => s.view == 'Rules')!
  let rules = root.querySelector(`[data-eid="${band.eid}"]`)!
  let reach = async (n: number) => {
    await page.turns.reach(band.eid, n)
    await settle()
    let open = rules.querySelector('.Window.is-last')!
    return {
      door: open.getAttribute('data-door'),
      said: open.textContent!,
      happened: [...open.querySelectorAll('.Letter_Tries li')]
        .map((li) => li.textContent!),
      choices: [...open.querySelectorAll('.Letter_Body li')]
        .map((li) => li.textContent!),
      windows: rules.querySelectorAll('.Window').length,
      declared: [...rules.querySelectorAll('.Declared')]
        .map((d) => d.getAttribute('data-declared')),
      told: rules.querySelector('.is-told')?.getAttribute('data-key'),
      toast: rules.querySelector('.Toast')?.textContent,
    }
  }
  let letters = () => page.yak.graph.read('.mail.target.decision .deliver *')
  let asked = await reach(1)
  // The bands above ran first, so the build's fix is T-7 and this is T-8.
  match(asked.said, /T-8 Which payments key should the build use\? open/)
  equal(await letters(), [])
  await reach(2)
  let [letter] = await letters()
  equal(
    [text(letter, 'mail', 'from'), text(letter, 'mail', 'to')],
    [SHOP, YOURS],
  )
  let [question] = await page.yak.graph.read('.decision *')
  // The letter is the one @yaks/inbox writes for the question.
  equal(
    text(letter, 'doc', 'body'),
    rendered(
      (await inboxAt(page.yak.graph, page.yak.vocab, page.yak.you))
        .find((t) => t.eid == question.entity.eid)!,
      { person: page.yak.you, from: SHOP, base: 'http://127.0.0.1:8787' },
    ),
  )
  // Each step of the effect shows one more thing that happened to the
  // letter, in the letter's own window.
  let [handed, refused, again, taken] = [
    await reach(3),
    await reach(4),
    await reach(5),
    await reach(6),
  ]
  equal([handed, refused, again, taken].map((w) => [w.door, w.windows]), [
    ['outbox', 3],
    ['outbox', 3],
    ['outbox', 3],
    ['outbox', 3],
  ])
  equal([handed.declared, handed.told], [['mail_post'], letter.entity.eid])
  equal(handed.choices, [
    'The test key: The build never charges a card. (recommended)',
    'The live key: The build checks the live account.',
  ])
  match(handed.said, /Reply with a choice number or your own answer/)
  equal([handed, refused, again, taken].map((w) => w.happened.length), [
    1,
    2,
    3,
    4,
  ])
  match(refused.happened[1], /refuses it: .*busy\. Nothing here failed/)
  match(again.happened[2], /^Second try, .* later: .* again, on its own\.$/)
  equal(taken.happened[3], 'The mail service takes it: sent.')
  equal([handed.toast, refused.toast, again.toast], [
    undefined,
    undefined,
    undefined,
  ])
  equal(taken.toast, `Email sent to ${YOURS}${text(letter, 'doc', 'title')}`)
  let replied = await reach(7)
  ;[question] = await page.yak.graph.read('.decision *')
  let [reply] = await page.yak.graph.read(
    `.comment.target=${question.entity.eid} *`,
  )
  equal(
    [replied.door, replied.windows, replied.declared, replied.told],
    ['reply', 4, ['decision_answered'], reply.entity.eid],
  )
  match(
    replied.said,
    /Re: Which payments key.*The test key.*T-8 answered: The test key/,
  )
  equal(
    [text(question, 'task', 'status'), text(question, 'decided', 'choice')],
    ['done', 'The test key'],
  )
  equal(
    [
      text(reply, 'mail', 'from'),
      text(reply, 'mail', 'reply_to'),
      text(reply, 'doc', 'body'),
    ],
    [YOURS, letter.entity.eid, 'The test key'],
  )
  page.page.close()
})

test("in the memory band your words become a memory your agent's persona carries, and a new session starts with them", async () => {
  let { root, page } = await whole()
  let band = SECTIONS.find((s) => s.view == 'Memory')!
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
  let started = memory.querySelector('.Window.is-last')!
  match(started.textContent!, /wears N-5# N-5 Your agent.*# C-9/)
  match(started.textContent!, new RegExp(said))
  equal(
    memory.querySelector('.is-told')?.getAttribute('data-key'),
    page.yak.agent,
  )
})

test('each thing the story draws leads back to the command whose write made it', async () => {
  let { root, page } = await whole()
  let drawn = (sel: string) =>
    root.querySelector(`.Figure_Sheet ${sel}`)!.getAttribute('data-key')!
  // The command that made a drawn thing, as its step lists it.
  let madeBy = (key: string) => {
    let at = page.figure.madeBy(key)!
    return scriptOf(steps[at.step - 1])[at.line].line
  }
  let titled = (title: string) =>
    page.yak.rows().find((b) => (b.doc as { title?: string })?.title == title)!
      .entity.eid
  let [account, checkout, edge, comment, done] = [1, 2].flatMap((i) =>
    scriptOf(steps[i]).map((c) => c.line)
  )
  equal([
    madeBy(titled('Sign up for payments')),
    madeBy(drawn('[data-name="filed.assignee"]')),
    madeBy(titled('Build the checkout')),
    madeBy(drawn('[data-name="requires"]')),
    madeBy(drawn('[data-name="comment.target"]')),
    madeBy(drawn('[data-name="completed.by"]')),
  ], [account, account, checkout, edge, comment, done])
})

test('a section changed from the prompt redraws in place, and the drawing keeps to the demo', async () => {
  let { root, page, settle } = await whole()
  let heading = root.querySelector(`[data-eid="${SELF}"] h2`)?.textContent
  equal(heading, 'This page is a graph you can change')
  equal(page.figure.query(), STORY)
  let sheet = () => root.querySelector('.Figure_Sheet')!.innerHTML
  equal(sheet().includes('>index.html<'), false)
  let wider = (name: string) =>
    ([...root.querySelectorAll('.Figure_Wider button')]
      .find((b) => b.textContent == name) as unknown as { click: () => void })
      .click()
  wider("the site's files")
  await settle()
  match(sheet(), />index.html</)
  wider('the demo')
  await settle()
})

test('the start draws at once, and each command only as far as the reader has scrolled past it', async () => {
  let { page, settle } = await open()
  await page.term.reach(steps, 4)
  await settle()
  let at = (n: number) => page.figure.reached(n, performance.now() + 5000)
  equal([at(0), at(1), at(3)], [1, 0, 0])
  page.figure.scroll([1, .5])
  equal([at(1), at(2), at(3)], [1, .5, 0])
})

test('the drawing widened and back to the demo still draws each command as far as it is scrolled past', async () => {
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
  let { root, page, settle } = await whole()
  let stack = root.querySelector('.Stack')!
  let rows = [...stack.querySelectorAll('.Source [data-row]')].map((p) =>
    p.getAttribute('data-row')
  )
  equal(rows, ['entity', 'deliver', 'doc', 'mail', 'delivered', 'created'])
  let source = stack.querySelector('.Source')!.textContent!
  match(source, /title: "Can you sign up for payments\?"/)
  match(source, /from: "hello@example.com"/)
  match(source, /message_id: "outbox-1"/)
  match(stack.querySelector('.Call')!.textContent!, /agent → graph_apply/)
  equal(
    [...stack.querySelectorAll('.Outbox li')].map((l) => l.className),
    ['is-handed', 'is-refused', 'is-handed', 'is-sent'],
  )
  match(
    stack.querySelector('.Outbox')!.textContent!,
    /busy\. Nothing here failed.*on its own\..*takes it: sent\./,
  )
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
})

test('every yaks.app in the words is a link to it that opens in a new tab, and code keeps its own as typed', async () => {
  let { root } = await whole()
  let said = [...root.querySelectorAll('*')].flatMap((el) =>
    [...el.childNodes].filter((n) =>
      n.nodeType == 3 && /\byaks\.app\b/.test(n.textContent!)
    ).map(() => el)
  )
  let away = (el: Element) =>
    el.localName == 'a' && el.getAttribute('href') == 'https://yaks.app' &&
    el.getAttribute('target') == '_blank' &&
    el.getAttribute('rel') == 'noopener'
  equal(said.filter((el) => !el.closest('code, pre') && !away(el)), [])
  equal(said.filter(away).length > 8, true)
  equal(said.some((el) => el.closest('code')), true)
})
