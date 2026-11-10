import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { placed } from './pages/chrome.ts'
import { run, type World } from './studio/run.ts'
import type { Book, Leaf } from './studio/rows.ts'
import { Page, type Studio } from './studio/views.ts'

let ONE = '00000000-0000-4000-8000-000000000001'
let book = (id: string, more: Partial<Book> = {}): Book => ({
  entity: { eid: id },
  doc: { title: 'Title of ' + id, body: 'Story of ' + id },
  coloring_book: {
    prompt: 'Idea of ' + id,
    mode: 'coloring',
    age: '8-12',
    style: 'ink',
    character: 'A fox in a red scarf',
    personalization: 'Mira',
    dedication: '',
  },
  ...more,
})
let leaf = (id: string, position: number, more: Partial<Leaf> = {}): Leaf => ({
  entity: { eid: id },
  coloring_page: { position, prompt: 'Scene ' + id, caption: 'Line ' + id },
  ...more,
})
let settings = {
  preview: false,
  printer: 'printbound',
  styles: ['pencil', 'ink'].map((id) => ({
    entity: { eid: id },
    doc: { title: id },
  })),
}

// A screen as the page draws it, under a preview's mount.
let drawn = (more: Partial<Studio>) =>
  parseHTML(renderToString(h(Page, {
    place: placed('https://fixture.test/preview/studio', '/studio'),
    screen: 'book',
    drawn: 1,
    settings,
    shelf: [],
    book: null,
    pages: [],
    idea: '',
    gather: null,
    notice: { text: '' },
    ...more,
  }))).document
let texts = (within: Element, selector: string) =>
  [...within.querySelectorAll(selector)].map((el) => el.textContent)

let shelf = drawn({
    screen: 'shelf',
    shelf: [
      book('a'),
      book('b', { print_review: {} }),
      book('c', { print_receipt: {} }),
    ],
  }),
  empty = drawn({ screen: 'shelf' }),
  saved = drawn({ book: book('a') }),
  fresh = drawn({ idea: 'A fox who bakes' }),
  pages = drawn({
    book: book('a'),
    pages: [
      leaf('p1', 1, { artwork: { blob: 'art', mime: 'image/png' } }),
      leaf('p2', 2, { page_failed: { message: 'The drawing timed out.' } }),
    ],
  }).querySelectorAll('.Sheet')

test('the shelf lists each book with how it stands, and an empty one says how to start', () => {
  equal(
    [...shelf.querySelectorAll('a[href^="#book/"]')].map((card) => [
      card.getAttribute('href'),
      card.querySelector('h2')!.textContent,
      card.querySelector('.State')!.textContent,
    ]),
    [
      ['#book/a', 'Title of a', 'Saved idea and pages'],
      ['#book/b', 'Title of b', 'Ready for document review'],
      ['#book/c', 'Title of c', 'Print receipt saved'],
    ],
  )
  equal(empty.querySelectorAll('a[href^="#book/"]').length, 0)
  ok(empty.querySelector('.Empty')!.textContent!.includes('Start an idea'))
  equal(empty.querySelector('a[href="#new"]')!.textContent, 'Start an idea')
})

test('the editor draws a saved idea into the fields a save reads by name', () => {
  let source = saved.querySelector('[data-source]')!
  let value = (name: string) => {
    let field = source.querySelector(`[name=${name}]`)!
    return field.localName == 'select'
      ? field.querySelector('[selected]')!.getAttribute('value')
      : field.getAttribute('value') ?? field.textContent
  }
  equal(
    ['title', 'prompt', 'mode', 'age', 'style', 'character', 'personalization']
      .map(value),
    [
      'Title of a',
      'Idea of a',
      'coloring',
      '8-12',
      'ink',
      'A fox in a red scarf',
      'Mira',
    ],
  )
  equal(fresh.querySelector('[name=prompt]')!.textContent, 'A fox who bakes')
  equal(fresh.querySelector('[data-act=prepare]'), null)
})

test('a page with artwork shows it and offers its free printable', () => {
  equal(
    pages[0].querySelector('img')!.getAttribute('src'),
    '/preview/studio/file?id=a&blob=art',
  )
  equal(
    pages[0].querySelector('a')!.getAttribute('href'),
    '/preview/studio/printable?id=a&page=p1',
  )
  equal(pages[1].querySelector('img'), null)
  equal(pages[1].querySelector('a'), null)
  equal(texts(pages[1], '.Sheet_Wait, .State'), [
    'Artwork has not been drawn yet.',
    'The drawing timed out.',
  ])
})

let held = <T>() => {
  let resolve!: (value: T) => void
  let promise = new Promise<T>((done) => resolve = done)
  return { promise, resolve }
}
// What a browser's fields have and linkedom's lack: the value a field was
// written with, which is how a view fills one.
let defaults = (window: unknown) => {
  let made = window as Record<string, { prototype: object }>
  let reflect = (
    tag: string,
    name: string,
    get: (el: Element) => unknown,
    set: (el: Element, value: string) => void,
  ) =>
    Object.defineProperty(made[tag].prototype, name, {
      configurable: true,
      get() {
        return get(this)
      },
      set(value) {
        set(this, value)
      },
    })
  reflect(
    'HTMLInputElement',
    'defaultValue',
    (el) => el.getAttribute('value') ?? '',
    (el, value) => el.setAttribute('value', value),
  )
  reflect(
    'HTMLTextAreaElement',
    'defaultValue',
    (el) => el.textContent,
    (el, value) => el.textContent = value,
  )
  return () => {
    for (let tag of ['HTMLInputElement', 'HTMLTextAreaElement']) {
      Reflect.deleteProperty(made[tag].prototype, 'defaultValue')
    }
  }
}

// The studio running on a document, the worker's doors answered here.
// Preact draws on the document the runtime names, so a fixture names its own
// for as long as it is acted on (`amid`) and puts back what was there.
let studio = async (
  address = `https://fixture.test/studio#new/${ONE}`,
  refused: Record<string, string> = {},
) => {
  let { document, window } = parseHTML('<div id="app"><p>Opening…</p></div>')
  Object.defineProperty(document, 'baseURI', { value: address })
  let amid = async <T>(act: () => T | Promise<T>): Promise<T> => {
    let before = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
      value: document,
      configurable: true,
    })
    let undefault = defaults(window)
    try {
      return await act()
    } finally {
      undefault()
      if (before) Object.defineProperty(globalThis, 'document', before)
      else Reflect.deleteProperty(globalThis, 'document')
    }
  }
  let app = document.querySelector('#app')!,
    // deno-lint-ignore no-explicit-any
    handlers = new Map<string, (event: any) => Promise<void>>()
  app.addEventListener = (name: string, heard: unknown) =>
    void handlers.set(name, heard as () => Promise<void>)
  let at = new URL(address)
  let location = {
    get hash() {
      return at.hash
    },
    set hash(hash: string) {
      at.hash = hash
    },
    get href() {
      return at.href
    },
  }
  let loads = new Map<string, ReturnType<typeof held<Book>>>()
  let posts: { name: string; value: Record<string, unknown> }[] = []
  let save: ReturnType<typeof held<Book>> | undefined
  let fetch = async (url: URL, init?: RequestInit) => {
    let name = url.pathname.split('/').pop()!, value: unknown = {}
    if (refused[name]) {
      return { ok: false, json: () => ({ error: refused[name] }) }
    }
    if (init?.body) {
      let body = JSON.parse(String(init.body))
      posts.push({ name, value: body })
      if (name == 'save') {
        value = await (save?.promise ?? book(body.id ?? body.draft))
      }
    } else if (name == 'settings') value = settings
    else if (name == 'shelf') value = []
    else if (name == 'book') {
      let loaded = await loads.get(url.searchParams.get('id')!)!.promise
      value = { book: loaded, pages: [] }
    }
    return { ok: true, json: () => value }
  }
  let navigate!: () => Promise<void>, place = ''
  let world = {
    document,
    location,
    history: {
      replaceState: (_data: unknown, _unused: string, to: string) => {
        at = new URL(to, at)
      },
    },
    fetch,
    FormData: function (form: Element) {
      return [...form.querySelectorAll('[name]')].map((field) => [
        field.getAttribute('name'),
        (field as HTMLInputElement).value,
      ])
    },
    addEventListener: (_name: string, heard: typeof navigate) =>
      navigate = heard,
    recovery: () =>
      Promise.resolve({
        bind(form: Element, name: string) {
          if (form.matches('[data-source]')) place = name
        },
        field() {},
        unbind() {},
        close() {},
      }),
  }
  await amid(() => run(world as unknown as World))
  return {
    amid,
    posts,
    location,
    $: <T extends Element = HTMLInputElement>(selector: string) =>
      app.querySelector<T>(selector)!,
    place: () => place,
    // Go to a book; its read answers when `resolve` is called.
    load: (id: string) => {
      let response = held<Book>()
      loads.set(id, response)
      location.hash = '#book/' + id
      let done = navigate()
      return { done, resolve: () => response.resolve(book(id)) }
    },
    // Go to a book and wait until it is drawn.
    opened: (id: string) => {
      loads.set(id, { promise: Promise.resolve(book(id)), resolve() {} })
      location.hash = '#book/' + id
      return navigate()
    },
    holdSave: () => save = held<Book>(),
    submit: () =>
      handlers.get('submit')!({
        preventDefault() {},
        target: app.querySelector('[data-source]'),
      }),
    press: (selector: string) =>
      handlers.get('click')!({ target: app.querySelector(selector) }),
  }
}
let prompted = await studio(
    'https://fixture.test/studio?prompt=A+fox+who+bakes',
  ),
  refused = await studio('https://fixture.test/studio', {
    shelf: 'Sign in to open your shelf.',
  }),
  signing = await studio(),
  racing = await studio(),
  leaving = await studio(),
  typing = await studio(undefined, { collection: 'No pages to gather.' }),
  preparing = await studio()

test('an idea brought in the address opens a new book and is saved at once', () => {
  let [{ name, value }] = prompted.posts
  equal([name, value.prompt], ['save', 'A fox who bakes'])
  equal(
    prompted.location.href,
    'https://fixture.test/studio#book/' + value.draft,
  )
  equal(prompted.$('[name=prompt]').value, 'A fox who bakes')
  let said = prompted.$('[role=status]')
  equal([said.textContent, said.className], ['Saved.', 'Notice'])
})

test('a refusal is said where the person is looking, as a failure', () => {
  let said = refused.$('main [role=status]')
  equal(said.textContent, 'Sign in to open your shelf.')
  ok(said.classList.contains('Notice-negative'))
})

test('signing in returns to the book that is open, its drafts kept under its own place', () =>
  signing.amid(async () => {
    let f = signing,
      login = async () => {
        await f.press('[data-account]')
        return new URL(f.$('[data-account]').getAttribute('href')!)
      }
    let fresh = await login()
    equal(fresh.origin + fresh.pathname, 'https://yaks.app/login')
    equal(
      fresh.searchParams.get('return'),
      `https://fixture.test/studio#new/${ONE}`,
    )
    equal(f.place(), 'book:' + ONE)
    await f.opened('b')
    equal(
      (await login()).searchParams.get('return'),
      'https://fixture.test/studio#book/b',
    )
    equal(f.place(), 'book:b')
  }))

test('the latest book stays when an older read finishes later', () =>
  racing.amid(async () => {
    let a = racing.load('a'), b = racing.load('b')
    b.resolve()
    await b.done
    a.resolve()
    await a.done
    equal(racing.$('[name=title]').value, 'Title of b')
  }))

test('the visible book is the one saved while the next book loads', () =>
  leaving.amid(async () => {
    let f = leaving
    await f.opened('a')
    let b = f.load('b')
    await f.submit()
    b.resolve()
    await b.done
    equal(f.posts.find((post) => post.name == 'save')!.value.id, 'a')
  }))

test('the saved book is the one prepared when navigation finishes during its save', () =>
  preparing.amid(async () => {
    let f = preparing
    await f.opened('a')
    let saved = f.holdSave(), pressed = f.press('[data-act=prepare]')
    await f.opened('b')
    saved.resolve(book('a'))
    await pressed
    equal(f.posts.find((post) => post.name == 'prepare')!.value.id, 'a')
  }))

test('what is typed stays when the page says something back, and a draw puts back what is saved', () =>
  typing.amid(async () => {
    let f = typing
    await f.opened('a')
    f.$('[name=title]').value = 'Typed and not saved'
    await f.press('[data-act=choose]')
    equal(f.$('[role=status]').textContent, 'No pages to gather.')
    equal(f.$('[name=title]').value, 'Typed and not saved')
    await f.opened('a')
    equal(f.$('[name=title]').value, 'Title of a')
  }))
