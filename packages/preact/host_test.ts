// A page drawn through the host, in a LinkeDOM document, against a page graph
// of its own: a write naming its views module draws the new renderers in the
// same root over the same graph, and a module that fails leaves the old ones.

import { equal, ok, test } from '@yaks/testing'
import { h } from 'preact'
// Pages load signals, whose options skip a redraw of unchanged props.
import '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'
import { client } from '@yaks/client'
import { type Bundle, define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import type { ComponentRenderer, HostRegistry } from './mod.ts'
import { type Draft, host, taken, type Views } from './host.ts'
import { CustomEvent, flush, stage } from './testing.ts'

let BASE = 'https://ada.yaks.app/soup/'
let VIEWS = `${BASE}views.ts`

test('the host takes a write that is its views module alone', () => {
  let file = (path: string, sha: string | null = 'abc', url = BASE + path) => ({
    path,
    sha,
    url,
  })
  let cases: [Draft['files'], string | null][] = [
    [[file('views.ts')], 'abc'],
    [[file('views.ts', 'a'), file('views.ts', 'b')], 'b'],
    [[file('views.ts', 'abc', `${VIEWS}?v=1`)], 'abc'],
    [[file('views.ts'), file('style.css')], null],
    [[file('main.ts')], null],
    [[file('views.ts', null)], null],
    [[{ path: 'views.ts', sha: 'abc' }], null],
    [[], null],
  ]
  for (let [files, sha] of cases) equal(taken({ files }, VIEWS), sha)
  equal(taken(null as never, VIEWS), null)
})

let vocab = loadVocab([{
  $defs: {
    doc: {
      component: true,
      sync: 'none',
      properties: { title: { type: 'string' } },
    },
  },
}])
let titled = (b: Bundle) => String((b.doc as { title: string }).title)
// A views module whose page is an input over the doc's title, a list of
// `rows` items, and `tag` saying which module drew it.
let module = (tag: string, Render?: ComponentRenderer['Render']): Views => ({
  views: define([
    Render
      ? { view: 'Page', match: parse('.doc'), Render } as ComponentRenderer
      : {
        view: 'Page',
        match: parse('.doc'),
        render: (b, h) =>
          h(
            'form',
            null,
            h('b', null, `${tag} ${titled(b)}`),
            h('input', { name: 'title', value: titled(b) }),
            h('ul', null, h('li', null, 'one'), h('li', null, 'two')),
          ),
      },
  ]) as HostRegistry,
})

// A page mounted through the host over a client of its own; `modules` is what
// each address imports, a function where it throws.
let page = async (
  modules: Record<string, Views | (() => never)>,
  words?: (url: string) => Promise<Response>,
  shell = '',
) => {
  let { root, document, free } = stage()
  root.innerHTML = shell
  Object.defineProperty(document, 'baseURI', {
    value: BASE,
    configurable: true,
  })
  let front = client(vocab, [], {
    vault: false,
    wireVault: false,
    provenance: false,
  })
  let graph = front.graph
  await front.mutate([{ entity: { eid: 'page' }, doc: { title: 'Soup' } }])
  let loaded: string[] = []
  let shown = await host({
    root,
    views: 'views.ts',
    client: front,
    fetch: words,
    draw: (Entity) => h(Entity, { eid: 'page', view: 'Page' }),
    load: (url) => {
      loaded.push(url)
      let got = modules[url]
      return typeof got == 'function'
        ? Promise.reject(got())
        : Promise.resolve(got)
    },
  })
  let reloads = 0
  let wrote = async (
    path: string | Draft['files'],
    sha = '',
    entries?: string[],
  ) => {
    let event = Object.assign(
      new CustomEvent('yak-draft', {
        cancelable: true,
        detail: {
          files: typeof path == 'string'
            ? [{ path, sha, url: BASE + path, entries }]
            : path,
        },
      }),
      { reload: () => reloads++ },
    )
    let passed = document.defaultView!.dispatchEvent(event)
    await shown.settled()
    return !passed
  }
  let text = () => root.querySelector('b')?.textContent
  let done = () => {
    shown.close()
    front.close()
    free()
  }
  return {
    root,
    document,
    front,
    graph,
    shown,
    loaded,
    wrote,
    text,
    reloads: () => reloads,
    done,
  }
}

let next = (sha: string) => `${VIEWS}?yak-draft=${sha}`

test('the first draw replaces what the root held before the scripts ran', async () => {
  let p = await page(
    { [VIEWS]: module('old') },
    undefined,
    '<header>Soup</header>',
  )
  try {
    equal([p.text(), p.root.querySelectorAll('header').length], [
      'old Soup',
      0,
    ])
  } finally {
    p.done()
  }
})

test('a write of the views module draws its renderers in the same root over the same graph, and takes the write from the reload', async () => {
  let p = await page({ [VIEWS]: module('old'), [next('abc')]: module('new') })
  try {
    equal(p.text(), 'old Soup')
    let [root, input, front, graph] = [
      p.root.firstChild,
      p.root.querySelector('input'),
      p.front,
      p.front.graph,
    ]
    equal(await p.wrote('views.ts', 'abc'), true)
    equal(p.loaded, [VIEWS, next('abc')])
    equal(p.text(), 'new Soup')
    ok(p.root.firstChild == root && p.root.querySelector('input') == input)
    ok(p.front == front && p.front.graph == graph && p.graph == graph)
    await p.front.mutate([{ entity: { eid: 'page' }, doc: { title: 'Stew' } }])
    await flush()
    equal(p.text(), 'new Stew')
    equal(await p.wrote('style.css', 'def'), false)
    equal([p.loaded.length, p.reloads()], [2, 0])
  } finally {
    p.done()
  }
})

test('a renderer that is a new function remounts its subtree, keeping focus, caret and scroll', async () => {
  let ran: string[] = []
  let Form = (tag: string): ComponentRenderer['Render'] => ({ e }) => {
    useLayoutEffect(() => {
      ran.push(`${tag} mounted`)
      return () => void ran.push(`${tag} gone`)
    }, [])
    return h(
      'form',
      null,
      h('b', null, `${tag} ${titled(e)}`),
      h('input', { name: 'title', value: titled(e) }),
      h('ul', null, h('li', null, 'one')),
    )
  }
  let p = await page({
    [VIEWS]: module('old', Form('old')),
    [next('abc')]: module('new', Form('new')),
  })
  let active: Element | null = null
  Object.defineProperty(p.document, 'activeElement', {
    get: () => active,
    configurable: true,
  })
  let caret: number[] = []
  let proto = Object.getPrototypeOf(p.root.querySelector('input')!)
  let { focus, setSelectionRange } = proto
  proto.focus = function () {
    active = this
  }
  proto.setSelectionRange = (from: number, to: number) => caret.push(from, to)
  try {
    let input = p.root.querySelector('input')!
    Object.assign(input, { selectionStart: 1, selectionEnd: 3 })
    active = input
    p.root.querySelector('ul')!.scrollTop = 120
    await p.wrote('views.ts', 'abc')
    equal(p.text(), 'new Soup')
    equal(ran, ['old mounted', 'old gone', 'new mounted'])
    let now = p.root.querySelector('input')!
    ok(now != input && active == now)
    equal(caret, [1, 3])
    equal(p.root.querySelector('ul')!.scrollTop, 120)
  } finally {
    Object.assign(proto, { focus, setSelectionRange })
    delete (p.document as { activeElement?: unknown }).activeElement
    p.done()
  }
})

test('a module that throws on import or on its first draw leaves the old renderers drawn and lets the page reload', async () => {
  let Broken = () => {
    throw new Error('broken renderer')
  }
  let p = await page({
    [VIEWS]: module('old'),
    [next('bad')]: () => {
      throw new SyntaxError('Unexpected token')
    },
    [next('empty')]: {} as Views,
    [next('draws')]: module('new', Broken),
  })
  let logged = console.error
  console.error = () => {}
  try {
    let old = p.shown.registry()
    for (let sha of ['bad', 'empty', 'draws']) {
      equal(await p.wrote('views.ts', sha), true)
      equal(p.text(), 'old Soup')
      ok(p.shown.registry() == old)
    }
    equal(p.reloads(), 3)
  } finally {
    console.error = logged
    p.done()
  }
})

test('of writes landing faster than their modules import, only the newest draws', async () => {
  let p = await page({
    [VIEWS]: module('old'),
    [next('a')]: module('first'),
    [next('b')]: module('second'),
  })
  try {
    let win = p.document.defaultView!
    for (let sha of ['a', 'b']) {
      win.dispatchEvent(
        new CustomEvent('yak-draft', {
          cancelable: true,
          detail: { files: [{ path: 'views.ts', sha, url: VIEWS }] },
        }),
      )
    }
    await p.shown.settled()
    await flush()
    equal(p.text(), 'second Soup')
  } finally {
    p.done()
  }
})

let more: VocabDoc = {
  $defs: {
    extra: {
      component: true,
      sync: 'none',
      properties: { label: { type: 'string' } },
    },
  },
}

test('a vocabulary write grows the same page graph and a subsequent views write reads its new components', async () => {
  let fetched: string[] = []
  let p = await page({
    [VIEWS]: module('old'),
    [next('new')]: {
      views: define([{
        view: 'Page',
        match: parse('.doc'),
        render: (e, h, { vocab }) =>
          h(
            'b',
            null,
            vocab!.prop('extra', 'label')
              ? String((e.extra as { label: string })?.label)
              : 'unknown',
          ),
      }]) as HostRegistry,
    },
  }, (url) => {
    fetched.push(String(url))
    return Promise.resolve(Response.json([...vocab.docs, more]))
  })
  try {
    let input = p.root.querySelector('input')
    equal(await p.wrote('vocab.json', 'words'), true)
    equal(fetched, [BASE + 'api/vocab.json?yak-draft=words'])
    equal(p.reloads(), 0)
    ok(p.front.graph === p.graph && p.root.querySelector('input') === input)
    await p.front.mutate([{
      entity: { eid: 'page' },
      extra: { label: 'New component' },
    }])
    await p.wrote('views.ts', 'new')
    equal(p.text(), 'New component')
    equal(p.front.ent('page')?.doc, { title: 'Soup' })
  } finally {
    p.done()
  }
})

test('an incompatible vocabulary reloads without changing the running graph or its state', async () => {
  let p = await page(
    { [VIEWS]: module('old') },
    () =>
      Promise.resolve(Response.json({
        $defs: {
          doc: { component: true, properties: { title: { type: 'number' } } },
        },
      })),
  )
  try {
    let before = p.front.vocab
    equal(await p.wrote('vocab.json', 'changed'), true)
    equal(p.reloads(), 1)
    ok(p.front.vocab === before)
    equal(p.text(), 'old Soup')
    equal(p.front.ent('page')?.doc, { title: 'Soup' })
  } finally {
    p.done()
  }
})

test('the host takes an imported dependency only when it reaches its views alone', async () => {
  let p = await page({
    [VIEWS]: module('old'),
    [next('dep')]: module('dependency'),
  })
  try {
    equal(await p.wrote('helper.ts', 'dep', [VIEWS]), true)
    equal(p.text(), 'dependency Soup')
    equal(
      await p.wrote('helper.ts', 'shared', [VIEWS, BASE + 'main.ts']),
      false,
    )
    equal(p.loaded, [VIEWS, next('dep')])
  } finally {
    p.done()
  }
})

let declared = (known = 'Ready', unknown = 'Missing'): Views => ({
  views: define([{
    view: 'Page',
    match: parse('.doc'),
    render: (_e, h, { vocab }) =>
      h('b', null, vocab!.prop('extra', 'label') ? known : unknown),
  }]) as HostRegistry,
})

test('views arriving during a vocabulary fetch wait for its components', async () => {
  let release!: (response: Response) => void
  let pending = new Promise<Response>((resolve) => {
    release = resolve
  })
  let p = await page({
    [VIEWS]: module('old'),
    [next('new')]: {
      views: define([{
        view: 'Page',
        match: parse('.doc'),
        render: (_e, h, { vocab }) =>
          h('b', null, vocab!.prop('extra', 'label') ? 'Ready' : 'Missing'),
      }]) as HostRegistry,
    },
  }, () => pending)
  try {
    let growing = p.wrote('vocab.json', 'words')
    let drawing = p.wrote('views.ts', 'new')
    equal(p.text(), 'old Soup')
    release(Response.json([...vocab.docs, more]))
    await Promise.all([growing, drawing])
    equal(p.text(), 'Ready')
    equal(p.reloads(), 0)
  } finally {
    p.done()
  }
})

test('a vocabulary-only write redraws existing renderers against the larger snapshot', async () => {
  let p = await page({
    [VIEWS]: {
      views: define([{
        view: 'Page',
        match: parse('.doc'),
        render: (_e, h, { vocab }) =>
          h('b', null, vocab!.prop('extra', 'label') ? 'Added' : 'Waiting'),
      }]) as HostRegistry,
    },
  }, () => Promise.resolve(Response.json([...vocab.docs, more])))
  try {
    equal(p.text(), 'Waiting')
    await p.wrote('vocab.json', 'words')
    equal(p.text(), 'Added')
  } finally {
    p.done()
  }
})

test('a combined vocabulary and views write merges before drawing', async () => {
  let p = await page({
    [VIEWS]: module('old'),
    [next('new')]: declared(),
  }, () => Promise.resolve(Response.json([...vocab.docs, more])))
  try {
    equal(
      await p.wrote([
        { path: 'vocab.json', sha: 'words', url: BASE + 'vocab.json' },
        { path: 'views.ts', sha: 'new', url: VIEWS },
      ]),
      true,
    )
    equal(p.text(), 'Ready')
    equal(p.reloads(), 0)
  } finally {
    p.done()
  }
})
