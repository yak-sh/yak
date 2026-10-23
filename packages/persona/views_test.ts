// The desk and the binders over a small graph, mounted through the inspector
// contract browse uses: every persona and skill on the desk, found by what is
// typed; a persona opened beside it, its binder listing what it carries in
// the order an agent reads it, what it names and what it leaves; a row
// dragged within a list or onto another put where it is dropped, and opened
// in place on its words; and a skill's instructions.
import { h, render } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { and } from '@yaks/query'
import { define, resolve } from '@yaks/render'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { memoryDoc } from '@yaks/memory/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { CARRIED, disclosureAt, type Host as UxHost, Ux } from '@yaks/ux'
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
  memory('m4444', 'not yet carried', 'tasks'),
  memory('m55555', 'for everyone'),
  link('common', 'contains', 'm22'),
  link('common', 'contains', 'm1', 1),
  link('common', 'contains', 'fleet'),
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
// The host's own faces: a tile for anything, a head and a conversation.
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
])

let host = (state: Bundle[] = [], wrote: Bundle[][] = []): Io => {
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
    state: (eid) => state.find((b) => b.entity.eid == eid),
    set: () => {},
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
let typing = (said: string) =>
  ({
    vocab,
    write: () => {},
    front: {
      mutate: () => {},
      watch: () => ({ value: [], subscribe: () => () => {} }),
      ent: () => undefined,
    },
    drafts: {
      text: (at: string) => at == FINDING ? said : '',
      type: () => {},
      spend: () => {},
    },
  }) as unknown as UxHost
let tree = (eid: string, view: string, io: Io, said: string) =>
  h(
    Ux,
    { host: typing(said) },
    h('main', {}, io.show(store.get([eid])[0] ?? { entity: { eid } }, view)),
  )
let drawn = (eid: string, view: string, said = '', io = host()) =>
  parseHTML(renderToString(tree(eid, view, io, said))).document
    .querySelector('main')!

let shelf = (page: Element, heading: string) =>
  [...page.querySelectorAll(`[data-shelf="${heading}"] [data-given]`)]
    .map((n) => n.getAttribute('data-given'))
let part = (page: Element, heading: string) =>
  page.querySelector(`[data-section="${heading}"]`)
let held = (page: Element, heading: string) =>
  [...part(page, heading)?.querySelectorAll('[data-held]') ?? []]
    .map((n) => n.getAttribute('data-held'))

let desk = drawn('context', 'Context.Page')
let found = drawn('context', 'Context.Page', 'BUILD')
let none = drawn('context', 'Context.Page', 'zzz')
let opened = drawn('common', 'Context')
let skill = drawn('testing', 'Context')
let press = opened.querySelector('[aria-controls]')?.getAttribute(
  'aria-controls',
)
let unfolded = drawn(
  'common',
  'Binder',
  '',
  host([{
    entity: { eid: String(press).replace('disclosure-', '') },
    Disclosure: { open: true },
  }]),
)

// A view mounted on a page, as a browser mounts it: its effects run, and it
// is read once what it asked for has come.
let mounted = async (eid: string, view: string, io = host()) => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let g = globalThis as { document?: unknown }
  let prior = g.document
  g.document = document
  let root = document.querySelector('main')!
  try {
    render(tree(eid, view, io, ''), root)
    for (let i = 0; i < 12; i++) await new Promise((go) => setTimeout(go, 0))
    return root.innerHTML
  } finally {
    render(null, root)
    g.document = prior
  }
}
let source = (html: string) =>
  parseHTML(`<main>${html}</main>`).document
    .querySelector('[data-markdown] pre')?.textContent
let personaMd = source(await mounted('common', 'Markdown'))
let skillMd = source(await mounted('testing', 'Markdown'))
let workshopMd = source(await mounted('common', 'Context'))
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

// Each row dropped on the binder, as a browser would, at the top of the list
// (`top`) or anywhere else on it: the lists after its batch is written, or
// nothing where it writes nothing.
let dropped = await (async () => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let g = globalThis as { document?: unknown }
  let prior = g.document
  g.document = document
  let wrote: Bundle[][] = []
  let root = document.querySelector('main')!
  let drop = async (heading: string, eid: string, top = false) => {
    let ev = new document.defaultView!.Event('drop', { bubbles: true })
    Object.assign(ev, {
      dataTransfer: { types: [CARRIED], getData: () => eid },
      clientY: top ? -1 : 1,
    })
    let at = part(root, heading)!
    ;(at.querySelector('[role=list]') ?? at).dispatchEvent(ev)
    await new Promise((go) => setTimeout(go, 0))
    let batch = wrote.splice(0)[0]
    if (!batch) return undefined
    let after = fresh()
    after.tx((tx) => tx.patch(batch))
    return lists(after)
  }
  try {
    render(tree('common', 'Binder', host([], wrote), ''), root)
    return {
      top: await drop('Carries', 'm22', true),
      across: await drop('Reads', 'm1', true),
      end: await drop('Carries', 'm333'),
      left: await drop('Not carried', 'm22'),
      self: await drop('Carries', 'common'),
      still: await drop('Carries', 'm1', true),
    }
  } finally {
    render(null, root)
    g.document = prior
  }
})()

// A carried document opened where it stands.
let link22 = store.read('.edge.from=common&.contains&*')
  .find((b) => (b.edge as { to: string }).to == 'm22')!
let opening = drawn(
  'common',
  'Binder',
  '',
  host([{
    entity: { eid: disclosureAt(`held/${link22.entity.eid}`) },
    Disclosure: { open: true },
  }]),
)

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

test('a persona opens beside the desk, lit, its binder and its try-out beside', () => {
  let lit = opened.querySelector('[data-given="common"] > .Tile')
  equal(lit?.getAttribute('aria-current'), 'page')
  ok(opened.querySelector('[data-binder="common"]'))
  ok(opened.querySelector('[data-chat="common"]'))
  ok(opened.textContent?.includes('works for Task Graph'))
})

test('a binder lists what it carries in the order an agent reads it', () => {
  equal(held(opened, 'Carries'), ['m1', 'fleet', 'm22'])
  equal(held(opened, 'Reads'), ['m22', 'm333'])
  ok(opened.querySelector('[data-twice]')?.textContent?.includes('map'))
})

test('what is in its scope and carried neither way waits behind a press', () => {
  let count = part(opened, 'Not carried')?.querySelector('.Section_Count')
  equal(count?.textContent, '1')
  equal(held(opened, 'Not carried'), [])
  equal(held(unfolded, 'Not carried'), ['m4444'])
})

test('a skill opens at the desk on its description and instructions', () => {
  ok(skill.querySelector('[data-binder="testing"]'))
  ok(skill.textContent?.includes('What testing says.'))
  let said = part(skill, 'Instructions')?.querySelector('strong')
  equal(said?.textContent, 'only')
})

test('a row dragged within a list is put where it is dropped', () => {
  equal(dropped.top, {
    contains: ['m22', 'm1', 'fleet'],
    reads: ['m22', 'm333'],
  })
  equal(dropped.still, undefined)
})

test('a row dropped on another list moves there, where it is dropped', () => {
  equal(dropped.across, {
    contains: ['fleet', 'm22'],
    reads: ['m1', 'm22', 'm333'],
  })
  equal(dropped.end, {
    contains: ['m1', 'fleet', 'm22', 'm333'],
    reads: ['m22'],
  })
})

test('a row dropped on Not carried leaves both lists; the persona itself is let fall', () => {
  equal(dropped.left, { contains: ['m1', 'fleet'], reads: ['m333'] })
  equal(dropped.self, undefined)
})

test('a carried document opens where it stands, on its title and body', () => {
  let opened = opening.querySelector('[data-detail="m22"]')
  ok(opened?.textContent?.includes('map'))
  ok(opened?.textContent?.includes('What map says.'))
  equal(opening.querySelectorAll('[data-detail]').length, 1)
  equal(
    opening.querySelector('[data-held="m22"] [aria-expanded]')
      ?.getAttribute('aria-expanded'),
    'true',
  )
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

test('what an agent reads sits beside the binder at the desk', () => {
  equal(workshopMd, said)
})
