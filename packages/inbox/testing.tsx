/** @jsxImportSource preact */
// What the inbox views' tests draw them with: a page of their own (linkedom),
// a graph that answers the summary as a server does, and a host standing in
// for a browsing app's. The host holds each line the views ask while they are
// mounted, answers it from the graph (or waits, when the test says so), keeps
// the rows it answered as the ones it draws by, takes writes, and draws
// entities through a small registry of shared renderers, behind the
// inspector's own door (@yaks/inspect `inspector`). Comments and drafts are
// bound to it as a browsing app binds them.
import { signal } from '@preact/signals'
import { type ComponentChild, render } from 'preact'
import { act } from 'preact/test-utils'
import { useLayoutEffect } from 'preact/hooks'
import { parseHTML } from 'linkedom'
import { until } from '@yaks/testing'
import { and, parse } from '@yaks/query'
import { define } from '@yaks/render'
import { client } from '@yaks/client'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { DecisionForm } from '@yaks/task/views'
import { projectDoc } from '@yaks/project/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { draftDoc, drafts as merging } from '@yaks/draft'
import { configureDrafts, drafts } from '@yaks/draft/input'
import { configureComments } from '@yaks/kernel/comment-host'
import { Note } from '@yaks/kernel/Comments'
import { docs as frontDocs } from '@yaks/inspect/front'
import {
  type Answer,
  type Asks,
  inspector,
  type Io,
  type View,
} from '@yaks/inspect'
import { inboxDoc } from './vocab.ts'
import { plugins } from './graph.ts'
import { inspectViews } from './views.tsx'

/** The words the tests' graph speaks. */
export let vocab = loadVocab([
  kernelDoc,
  docDoc,
  taskDoc,
  projectDoc,
  personaDoc,
  notifyDoc,
  sessionDoc,
  toolsDoc,
  draftDoc,
  inboxDoc,
])

/** A graph holding `rows`, answering the inbox summary as a server does. */
export let shop = async (rows: Bundle[]): Promise<Graph> => {
  let storage = ram(vocab)
  // Fixture authors and times are facts already stored, not new writes.
  await storage.tx((tx) => tx.patch(rows))
  let g: Graph
  g = graph({
    vocab,
    storage,
    plugins: plugins({
      get graph() {
        return g
      },
    }),
  })
  return g
}

let doc = (b?: Bundle) =>
  b?.doc as { title?: string; body?: string } | undefined
let body = (b?: Bundle) => doc(b)?.body ?? ''
let title = (b?: Bundle) =>
  doc(b)?.title || body(b).split('\n').find((l) => l.trim()) || ''

// What a browsing app draws entities with, as little as the inbox needs: a
// row is a link naming it, with its id; a page its words, and a decision's
// answers; a name; an id.
let shared: View[] = [
  {
    view: 'Tile',
    match: and(),
    Render: ({ e, io }) => (
      <a class='Tile' href={io.link(e.entity.eid)}>
        <span class='Tile_Title'>{title(e)}</span>
        <span class='Id'>{io.id(e)}</span>
      </a>
    ),
  },
  {
    view: 'Full',
    match: and(),
    Render: ({ e }) => <section class='Full'>{body(e)}</section>,
  },
  {
    view: 'Full',
    match: parse('.decision'),
    Render: ({ e, io }) => (
      <DecisionForm e={e} drafts={drafts} apply={io.apply} name={io.name} />
    ),
  },
  {
    view: 'Inline',
    match: and(),
    Render: ({ e, io }) => <b class='Inline'>{io.name(e.entity.eid)}</b>,
  },
  {
    view: 'Id',
    match: and(),
    Render: ({ e, io }) => <span class='Id'>{io.id(e)}</span>,
  },
]

/** A browsing app's host, standing in. `read` answers a line as the server
 * would; with `answering: false` a line waits until the test answers it. More
 * renderers go ahead of the shared ones, as a package's own would. */
export let host = (
  { read = () => [], answering = true, views = [] }: {
    read?: (line: string) => Bundle[] | Promise<Bundle[]>
    answering?: boolean
    views?: View[]
  } = {},
) => {
  let answers = signal(new Map<string, Answer>())
  let store = signal(new Map<string, Bundle>())
  let holds = new Map<string, number>()
  let asked: string[] = [], dropped: string[] = [], errors: unknown[] = []
  let applied: Bundle[][] = []
  let put = (line: string, answer: Answer) => {
    answers.value = new Map(answers.value).set(line, answer)
    let rows = new Map(store.value)
    for (let b of answer.rows) rows.set(b.entity.eid, b)
    store.value = rows
  }
  let answer = async (line: string) => {
    try {
      put(line, { rows: await read(line), ready: true })
    } catch (error) {
      errors.push(error)
      put(line, { rows: [], ready: false, error: String(error) })
    }
  }
  let lineOf = (a: Asks[string]) => typeof a == 'string' ? a : a.query
  let useAnswers = (asks: Asks): Record<string, Answer> => {
    let lines = Object.values(asks).map(lineOf)
    useLayoutEffect(() => {
      for (let line of lines) {
        let n = holds.get(line) ?? 0
        holds.set(line, n + 1)
        if (n) continue
        asked.push(line)
        if (answering) void answer(line)
      }
      return () => {
        for (let line of lines) {
          let n = holds.get(line)! - 1
          if (n) holds.set(line, n)
          else {
            holds.delete(line)
            dropped.push(line)
          }
        }
      }
    }, [JSON.stringify(lines)])
    let now = answers.value
    return Object.fromEntries(
      Object.entries(asks).map((
        [name, a],
      ) => [name, now.get(lineOf(a)) ?? { rows: [], ready: false }]),
    )
  }
  let { Door, io } = inspector(define([...views, ...inspectViews, ...shared]), {
    vocab,
    useAnswers,
    front: client(loadVocab(frontDocs), [], { vault: false }),
    apply: (bundles) => {
      applied.push(bundles)
      let rows = new Map(store.value)
      for (let { entity, ...comps } of bundles) {
        let was = rows.get(entity.eid) ?? { entity }
        let next: Bundle = { ...was }
        for (let [name, comp] of Object.entries(comps)) {
          if (comp == null) delete next[name]
          else next[name] = comp
        }
        rows.set(entity.eid, next)
      }
      store.value = rows
      return Promise.resolve()
    },
    get: (eid) => store.value.get(eid),
    link: (eid) => `/${eid}`,
    find: (q) => `/?q=${q}`,
    go: () => {},
    id: (b) => `#${b.entity.num ?? b.entity.eid}`,
    kind: () => 'entity',
    name: (eid) => title(store.value.get(eid)) || eid,
    when: (at) => `at ${at}`,
    edits: true,
  })
  return {
    io,
    Door,
    /** every line asked, in the order it was first held */
    asked,
    /** every line let go once nothing held it */
    dropped,
    /** the lines held now */
    held: () => [...holds.keys()],
    errors,
    applied,
    /** answer a line now, as the server would */
    answer,
    /** refuse a line, as a server refusing the read */
    refuse: (line: string, why: string) =>
      put(line, { rows: [], ready: false, error: why }),
    /** let lines asked from now on be answered as they are asked */
    start: () => {
      answering = true
    },
    /** put rows in what the host holds, as a page's cache would */
    hold: (rows: Bundle[]) => {
      let next = new Map(store.value)
      for (let b of rows) next.set(b.entity.eid, b)
      store.value = next
    },
  }
}

/** The host's `io`, for the views' types. */
export type Host = ReturnType<typeof host> & { io: Io }

// Comments and drafts, bound as a browsing app binds them: drafts kept in a
// graph of their own, typed by one person, with what a draft is spent into
// written there beside it (`spent`); comment notes drawn whole.
let pad = client(vocab, [merging()], { vault: false, wireVault: false })
await pad.mutate([{ entity: { eid: 'person' }, person: {} }])
/** What sending a draft wrote beside it, in order. */
export let spent: Bundle[] = []
configureDrafts({
  client: {
    mutate: (bundles) => {
      spent.push(...bundles.filter((b) => !b.draft))
      return pad.mutate(bundles)
    },
    watch: (query) => pad.watch(query),
  },
  by: () => 'person',
  people: () => Promise.resolve([]),
  stash: () => undefined,
})
let boxes = signal(new Map<string, Record<string, unknown>>())
configureComments({
  get: (eid) => ({ entity: { eid } }),
  id: (b) => `#${b.entity.eid}`,
  useRows: () => [],
  useModel: () => undefined,
  useRepo: () => undefined,
  usePage: (name, place) => ({
    value: boxes.value.get(`${name}|${place}`),
    set: (value) => {
      boxes.value = new Map(boxes.value).set(`${name}|${place}`, value)
    },
  }),
  render: (b, view) =>
    view == 'Thread.Note'
      ? <Note c={b} />
      : view == 'Thread.Body'
      ? body(b)
      : title(b),
  link: (b) => ({ href: `/${b.entity.eid}` }),
  markdown: (text) => text,
  pending: () => false,
  has: (comp) => !!vocab.comp(comp),
  modelName: () => undefined,
  when: (at) => String(at ?? ''),
  timestamp: (at) => String(at ?? ''),
  command: () => false,
  hints: () => [],
})

/** Draw `node` on a page of its own; `free` takes it down. */
export let mount = (node: ComponentChild) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  render(node, root)
  return {
    root,
    free() {
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    },
  }
}

/** Wait for a fact the page shows, letting what it waits on land. */
export let wait = (fact: () => boolean, label: string) =>
  until(async () => {
    await act(() => Promise.resolve())
    return fact()
  }, { label })

/** Press a control as a person would. */
export let press = (el: Element | null | undefined) =>
  act(() => (el as HTMLElement).click())

/** The text of each element `selector` finds. */
export let texts = (root: Element, selector: string) =>
  [...root.querySelectorAll(selector)].map((n) => n.textContent)

/** The button that says `text`. */
export let button = (root: Element, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent == text)
