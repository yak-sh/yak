// The desk and the body of a persona's and a skill's Full page over a small
// graph, mounted through the inspector contract browse uses: every persona and
// skill on the desk, found by what is typed; a persona opened beside it, its
// Full page in the middle; every document it contains and reads, typed into
// where it shows on a click, with nothing on it to drag; a new document
// written into a list; and a skill's instructions.
import { h, render } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { and } from '@yaks/query'
import { define, resolve } from '@yaks/render'
import { client } from '@yaks/client'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { memoryDoc } from '@yaks/memory/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { type Host as UxHost, Ux } from '@yaks/ux'
import { docs as uxDocs } from '@yaks/ux/vocab'
import {
  all,
  type Answer,
  type Asks,
  type Bundle,
  type Io,
  type View,
} from '@yaks/inspect'
import { personaDoc } from './comp.ts'
import { inspectViews } from './inspect.ts'
import { FINDING } from './desk.ts'
import { voice } from './voice.ts'
import { served, wear } from './worn.ts'
import { renderSkill } from './skill-text.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  edgeDoc,
  docDoc,
  taskDoc,
  projectDoc,
  toolsDoc,
  memoryDoc,
  personaDoc,
], [kernelKeywords, edgeKeywords])

let doc = (eid: string, title: string, more: Bundle = { entity: { eid } }) => ({
  ...more,
  entity: { eid },
  doc: { title, body: `What ${title} says.` },
})
let memory = (eid: string, title: string, scope?: string) =>
  doc(eid, title, {
    entity: { eid },
    memory: scope ? { scope } : {},
    created: { at: `2026-10-0${eid.length}T00:00:00Z` },
  })
let seed = [
  { entity: { eid: 'tasks' }, project: {}, doc: { title: 'Task Graph' } },
  doc('common', 'tasks-v2 common persona', {
    entity: { eid: 'common' },
    persona: { home: 'tasks' },
  }),
  doc('fleet', 'fleet base', { entity: { eid: 'fleet' }, persona: {} }),
  doc('testing', 'testing', {
    entity: { eid: 'testing' },
    skill: { invoke: 'both' },
    content: { body: 'Run **only** what your change could break.' },
  }),
  doc('ui', 'ui-building', {
    entity: { eid: 'ui' },
    skill: {},
    content: { body: 'Build with the kit.' },
  }),
  memory('m1', 'signal over noise', 'tasks'),
  memory('m22', 'map', 'tasks'),
  memory('m333', 'one idea', 'tasks'),
  memory('m4444', 'not linked', 'tasks'),
  { entity: { eid: 'grep' }, tool: { name: 'grep' } },
  link('common', 'contains', 'm22'),
  link('common', 'contains', 'm1', 1),
  link('common', 'contains', 'fleet'),
  link('common', 'contains', 'grep'),
  link('common', 'reads', 'm333'),
  link('common', 'reads', 'm22'),
]
let fresh = () => {
  let at = ram(vocab)
  at.tx((tx) => tx.patch(seed))
  return at
}
let store = fresh()

let asked = (q: string): Answer =>
  q.endsWith('&.count')
    ? { rows: [], count: store.read(q.slice(0, -7)).length, ready: true }
    : { rows: store.read(q), ready: true }
let title = (e?: Bundle) => String((e?.doc as { title?: string })?.title ?? '')
// The host's own faces: a tile for anything and a conversation; and Full, as
// browse draws it, its title over its body, saying whether it drew its chat.
let face = (view: string, tag: string): View => ({
  view,
  match: and(),
  Render: ({ e }) => h('span', { [`data-${tag}`]: e.entity.eid }, title(e)),
})
let registry = define<View>([
  ...inspectViews,
  ...all,
  face('Tile', 'tile'),
  face('Conversation', 'chat'),
  {
    view: 'Full',
    match: and(),
    Render: ({ e, io, ctx }) =>
      h(
        'div',
        { 'data-full': e.entity.eid, 'data-beside': String(ctx.chat) },
        h('h1', {}, title(e)),
        io.show(e, 'Full.Body'),
      ),
  },
])

// The page's own graph, as browse keeps it: where a typed value's `Edit`
// state lives.
type Page = ReturnType<typeof client>
let page = (): Page =>
  client(loadVocab([...uxDocs]), [], { vault: false, wireVault: false })

let host = (front: Page, wrote: Bundle[][] = []): Io => {
  let answers = (asks: Asks) =>
    Object.fromEntries(
      Object.entries(asks).map((
        [key, ask],
      ) => [key, asked(typeof ask == 'string' ? ask : ask.query)]),
    )
  let io: Io = {
    vocab,
    ask: answers,
    get: (id) => store.get([id])[0],
    show: (e, view, ctx = {}) => {
      let r = resolve(registry, e, view, vocab)
      return r
        ? h(r.Render, { e, got: answers(r.asks?.(e, io, ctx) ?? {}), io, ctx })
        : null
    },
    can: (e, view) => !!resolve(registry, e, view, vocab),
    state: (eid) => front.ent(eid),
    set: (bs) => void front.mutate(bs),
    apply: (bs) => {
      wrote.push(bs)
    },
    edits: true,
    link: (id) => `/${id}`,
    find: (q) => `/find?q=${encodeURIComponent(q)}`,
    go: () => {},
    id: (e) => e.entity.eid,
    kind: () => 'persona',
    name: (id) => title(store.get([id])[0]) || id,
    when: (at) => at,
  }
  return io
}
let typing = (said: string, front: Page) =>
  ({
    vocab,
    write: () => {},
    front,
    drafts: {
      text: (at: string) => at == FINDING ? said : '',
      type: () => {},
      spend: () => {},
    },
  }) as unknown as UxHost
let tree = (eid: string, view: string, said: string, front: Page, io: Io) =>
  h(
    Ux,
    { host: typing(said, front) },
    h('main', {}, io.show(store.get([eid])[0] ?? { entity: { eid } }, view)),
  )
let drawn = (eid: string, view: string, said = '') => {
  let front = page()
  try {
    return parseHTML(
      renderToString(tree(eid, view, said, front, host(front))),
    ).document.querySelector('main')!
  } finally {
    front.close()
  }
}

let shelf = (page: Element, heading: string) =>
  [...page.querySelectorAll(`[data-shelf="${heading}"] [data-given]`)]
    .map((n) => n.getAttribute('data-given'))
let part = (page: Element, heading: string) =>
  page.querySelector(`[data-section="${heading}"]`)
let carried = (page: Element, heading: string) =>
  [...part(page, heading)?.querySelectorAll('[data-carried]') ?? []]
    .map((n) => n.getAttribute('data-carried'))

let desk = drawn('context', 'Context.Page')
let found = drawn('context', 'Context.Page', 'BUILD')
let none = drawn('context', 'Context.Page', 'zzz')
let opened = drawn('common', 'Context')
let skill = drawn('testing', 'Context')

// A view mounted on a page, as a browser mounts it: its effects run, and
// `act` presses on it once what it asked for has come.
let settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((go) => setTimeout(go, 0))
}
let mounted = async (
  eid: string,
  view: string,
  act: (root: Element) => unknown = () => {},
  wrote: Bundle[][] = [],
) => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let g = globalThis as { document?: unknown }
  let prior = g.document
  g.document = document
  let root = document.querySelector('main')!
  let front = page()
  try {
    render(tree(eid, view, '', front, host(front, wrote)), root)
    await settle()
    let did = await act(root)
    await settle()
    return { html: root.innerHTML, did }
  } finally {
    render(null, root)
    g.document = prior
    front.close()
  }
}
let press = (root: Element, el: Element | null) =>
  el?.dispatchEvent(
    new (root.ownerDocument!.defaultView!.Event)('click', { bubbles: true }),
  )
let source = (html: string) =>
  parseHTML(`<main>${html}</main>`).document
    .querySelector('[data-markdown] pre')?.textContent
let personaMd = source((await mounted('common', 'Markdown')).html)
let skillMd = source((await mounted('testing', 'Markdown')).html)
let workshopMd = source((await mounted('common', 'Context')).html)
let said = voice(vocab)((await wear(store, vocab)('common'))!)

// A persona's lists, read from a store: the far ends of each, in the order
// an agent reads them.
let lists = (at = store) =>
  Object.fromEntries(
    ['contains', 'reads'].map((rel) => [
      rel,
      at.read(`.edge.from=common&.${rel}&*`).toSorted(served)
        .map((b) => (b.edge as { to: string }).to),
    ]),
  )

// A click on a carried document's title, then on its body: each is typed
// into where it stands.
let clicked = (await mounted('common', 'Full.Body', async (root) => {
  let doc = () => root.querySelector('[data-carried="m22"]')!
  let typed = (at: string) =>
    !!doc().querySelector(`${at} .Edit`)?.hasAttribute('contenteditable')
  let before = { title: typed('.Doc_Title'), body: typed('[data-words]') }
  press(root, doc().querySelector('.Doc_Title'))
  await settle()
  let title = typed('.Doc_Title')
  press(root, doc().querySelector('[data-words]'))
  await settle()
  return {
    before,
    title,
    body: typed('[data-words]'),
    drags: root.querySelectorAll('[data-section] [draggable="true"]').length,
  }
})).did

// + new document under Contains: what it writes, and its title open.
let writing = await (async () => {
  let wrote: Bundle[][] = []
  let { did } = await mounted('common', 'Full.Body', async (root) => {
    press(root, root.querySelector('[data-write="contains"]'))
    await settle()
    return wrote[0]
  }, wrote)
  let batch = did as Bundle[]
  let after = fresh()
  after.tx((tx) => tx.patch(batch))
  return { made: batch[0].entity.eid, doc: batch[0], lists: lists(after) }
})()

test('the desk lists every persona and skill by title, each with its cover', () => {
  equal(shelf(desk, 'Personas'), ['fleet', 'common'])
  equal(shelf(desk, 'Skills'), ['testing', 'ui'])
  ok(desk.textContent?.includes('for Task Graph'))
  ok(desk.textContent?.includes('What ui-building says.'))
  ok(desk.querySelector('.Head_Facts')?.textContent?.includes('2 skills'))
})

test('what is typed finds a persona or a skill by its words', () => {
  equal(shelf(found, 'Skills'), ['ui'])
  equal(shelf(found, 'Personas'), [])
  ok(none.textContent?.includes('none fits “zzz”'))
})

test('a persona opens beside the desk, lit, its Full page and its try-out beside', () => {
  let lit = opened.querySelector('[data-given="common"] > .Tile')
  equal(lit?.getAttribute('aria-current'), 'page')
  let full = opened.querySelector('[data-full="common"]')
  equal(full?.getAttribute('data-beside'), 'false')
  ok(opened.querySelector('[data-chat="common"]'))
  ok(opened.textContent?.includes('works for Task Graph'))
})

test("a persona's page shows each document it contains and reads, title and body, in the order an agent is given them", () => {
  equal(carried(opened, 'Contains'), ['m1', 'fleet', 'm22'])
  equal(carried(opened, 'Reads'), ['m22', 'm333'])
  let doc = part(opened, 'Contains')?.querySelector('[data-carried="m1"]')
  ok(doc?.textContent?.includes('signal over noise'))
  ok(doc?.textContent?.includes('What signal over noise says.'))
})

test('a click types into a carried document where it shows, and nothing on it drags', () => {
  equal(clicked, {
    before: { title: false, body: false },
    title: true,
    body: true,
    drags: 0,
  })
})

test('a new document is written into the list after the others, its title open for typing', () => {
  equal(writing.doc, {
    entity: { eid: writing.made },
    doc: { title: '', body: '' },
  })
  equal(writing.lists.contains, ['m1', 'fleet', 'grep', 'm22', writing.made])
})

test('a skill opens at the desk on its description and instructions', () => {
  ok(skill.querySelector('[data-body="testing"]'))
  ok(skill.textContent?.includes('What testing says.'))
  let said = part(skill, 'Instructions')?.querySelector('strong')
  equal(said?.textContent, 'only')
})

test("a persona's Markdown view is the whole text an agent wearing it is given", () => {
  equal(personaMd, said)
  let at = (words: string) => said.indexOf(words)
  ok(at('What signal over noise says.') < at('What fleet base says.'))
  ok(at('What fleet base says.') < at('## Reads'))
})

test("a skill's Markdown view is its SKILL.md", () => {
  let [b] = store.get(['testing'])
  equal(
    skillMd,
    renderSkill({ doc: b.doc, skill: b.skill, content: b.content }),
  )
})

test('what an agent reads sits beside the Full page at the desk', () => {
  equal(workshopMd, said)
})

test('a persona and a skill are typed into where they stand, with no edit view', () => {
  for (let page of [opened, skill]) {
    equal(page.querySelectorAll('[data-body] [aria-pressed]').length, 0)
    equal(page.querySelectorAll('[data-body] select').length, 0)
    ok(page.querySelector('[data-body] [data-words="doc.body"].Body-typed'))
  }
  ok(
    skill.querySelector(
      '[data-section="Instructions"] [data-words="content.body"]',
    ),
  )
})
