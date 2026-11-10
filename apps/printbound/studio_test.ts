import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'

let sources = await Promise.all(
  ['printbound'].map(async (app) => ({
    app,
    text: await Deno.readTextFile(
      new URL(`../${app}/studio.js`, import.meta.url),
    ),
  })),
)
let AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
let held = <T>() => {
  let resolve!: (value: T) => void
  let promise = new Promise<T>((done) => resolve = done)
  return { promise, resolve }
}
let row = (id: string) => ({
  entity: { eid: id },
  doc: { title: id },
  book_source: { markdown: 'Words from ' + id },
  coloring_source: { prompt: 'Idea from ' + id },
})
let fixture = async ({ app, text }: typeof sources[number]) => {
  let { document } = parseHTML(
    '<a data-account href="https://yaks.app/login">Sign in</a><main id="desk"></main><p id="notice"></p>',
  )
  Object.defineProperty(document, 'baseURI', {
    value: 'https://fixture.test/',
  })
  let desk = document.querySelector('#desk')!, handlers = new Map()
  desk.addEventListener = (name: string, fn: unknown) => handlers.set(name, fn)
  let location = {
    hash: '#new/00000000-0000-4000-8000-000000000001',
    get href() {
      return 'https://fixture.test/studio' + this.hash
    },
  }
  let account = document.querySelector('[data-account]')!,
    accountClick = () => {},
    place = ''
  account.addEventListener = (
    _name: string,
    handler: EventListenerOrEventListenerObject,
  ) => {
    accountClick = handler as () => void
  }
  let history = {
    replaceState: (_data: unknown, _unused: string, hash: string) => {
      location.hash = hash
    },
  }
  let loads = new Map<
    string,
    ReturnType<typeof held<Record<string, unknown>>>
  >()
  let posts: { name: string; value: Record<string, unknown> }[] = []
  let save: ReturnType<typeof held<Record<string, unknown>>> | undefined
  let fetch = async (url: URL, init?: RequestInit) => {
    let name = url.pathname.split('/').pop()!, value
    if (init?.body) {
      let body = JSON.parse(String(init.body))
      posts.push({ name, value: body })
      value = name === 'save'
        ? await (save?.promise ?? row(String(body.id)))
        : {}
    } else if (name === 'settings') value = { preview: true, styles: [] }
    else if (name === 'book') {
      let id = url.searchParams.get('id')!
      let loaded = await loads.get(id)!.promise
      value = app === 'printbound' ? loaded : { book: loaded, pages: [] }
    } else value = []
    return { ok: true, json: () => Promise.resolve(value) }
  }
  let navigate!: () => Promise<void>
  let run = new AsyncFunction(
    'document',
    'fetch',
    'recovery',
    'location',
    'history',
    'addEventListener',
    'FormData',
    text.replace(/^import[^\n]+\n/, ''),
  )
  await run(
    document,
    fetch,
    () =>
      Promise.resolve({
        bind(form: Element, name: string) {
          if (form.matches('[data-source]')) place = name
        },
        field() {},
        unbind() {},
      }),
    location,
    history,
    (_name: string, handler: () => Promise<void>) => navigate = handler,
    function (form: Element) {
      return Array.from(form.querySelectorAll('[name]')).map((input) => [
        input.getAttribute('name'),
        (input as HTMLInputElement).value,
      ])
    },
  )
  await navigate()
  return {
    document,
    posts,
    login: () => {
      accountClick()
      return { url: new URL(account.getAttribute('href')!), place }
    },
    load: (id: string) => {
      let response = held<Record<string, unknown>>()
      loads.set(id, response)
      location.hash = '#book/' + id
      let done = navigate()
      return { done, resolve: () => response.resolve(row(id)) }
    },
    holdSave: () => save = held<Record<string, unknown>>(),
    submit: () =>
      handlers.get('submit')({
        preventDefault() {},
        target: desk.querySelector('[data-source]'),
      }),
    prepare: () =>
      handlers.get('click')({
        target: desk.querySelector('[data-act=prepare]'),
      }),
  }
}

for (let source of sources) {
  test(`${source.app} signs in with the current stable recovery place and returns to the selected book`, async () => {
    let f = await fixture(source), fresh = f.login()
    equal(fresh.url.origin + fresh.url.pathname, 'https://yaks.app/login')
    equal(
      fresh.url.searchParams.get('return'),
      'https://fixture.test/studio#new/00000000-0000-4000-8000-000000000001',
    )
    equal(fresh.place, 'book:00000000-0000-4000-8000-000000000001')
    let selected = '00000000-0000-4000-8000-000000000002',
      pending = f.load(selected)
    pending.resolve()
    await pending.done
    let saved = f.login()
    equal(
      saved.url.searchParams.get('return'),
      'https://fixture.test/studio#book/' + selected,
    )
    equal(saved.place, 'book:' + selected)
  })

  test(`${source.app} keeps the latest book when older reads finish later`, async () => {
    let f = await fixture(source), a = f.load('a'), b = f.load('b')
    b.resolve()
    await b.done
    a.resolve()
    await a.done
    equal(f.document.querySelector('[name=title]')!.getAttribute('value'), 'b')
  })

  test(`${source.app} saves the visible book while the next book loads`, async () => {
    let f = await fixture(source), a = f.load('a')
    a.resolve()
    await a.done
    let b = f.load('b')
    await f.submit()
    b.resolve()
    await b.done
    equal(f.posts.find((post) => post.name === 'save')!.value.id, 'a')
  })

  test(`${source.app} prepares the saved book if navigation finishes during save`, async () => {
    let f = await fixture(source), a = f.load('a')
    a.resolve()
    await a.done
    let saved = f.holdSave(), preparing = f.prepare(), b = f.load('b')
    b.resolve()
    await b.done
    saved.resolve(row('a'))
    await preparing
    equal(f.posts.find((post) => post.name === 'prepare')!.value.id, 'a')
  })
}
