// The studio as a person meets it: studio.html in a LinkeDOM document with
// the desk started in it, and the studio's door answered here. Each case has
// a desk of its own, opened as the file loads; it types and presses, then
// reads what shows and what was sent.
import { cleanup, clock, equal, match, test, tick } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { type Page, start } from './desk.ts'

// The Worker sets the bar, and its sign-in link, where the page marks it.
let html = (await Deno.readTextFile(new URL('./studio.html', import.meta.url)))
  .replace(
    '<!--mast-->',
    '<a data-account href="https://yaks.app/login">Sign in to order</a>',
  )
let NEW = '00000000-0000-4000-8000-000000000001'
let AT = 'https://fixture.test/studio'

type Json = Record<string, unknown>
let held = <T>() => {
  let resolve!: (value: T) => void
  let promise = new Promise<T>((done) => resolve = done)
  return { promise, resolve }
}
let row = (id: string, more: Json = {}): Json => ({
  entity: { eid: id },
  doc: { title: id },
  book_source: { markdown: 'Words from ' + id },
  ...more,
})
let prepared = {
  book_prepared: {
    document: {
      pages: [{ role: 'title', number: 1, blob: 'p1' }],
      interior: { blob: 'in' },
      cover: { blob: 'co' },
    },
  },
}

// preact makes its elements from the `document` global, so whoever draws is
// lent the page's for as long as it does.
let lend = (document: unknown) => {
  let g = globalThis as { document?: unknown }, was = g.document
  g.document = document
  return () => void (g.document = was)
}

// What the door answers, by the name asked: a function of what was posted,
// or of the id a read named. An answer with an `error` is a refusal.
type Answers = Record<string, (asked: Json) => unknown>
let door: Answers = {
  shelf: () => [],
  book: ({ id }) => row(String(id)),
  save: ({ id, draft }) => row(String(id ?? draft)),
}

let desk = async (hash = '#new/' + NEW, answers: Answers = {}) => {
  // The page's events are LinkeDOM's own; the window's are the runtime's.
  let { document, Event: Dom } = parseHTML(html)
  Object.defineProperty(document, 'baseURI', { value: AT })
  let root = document.querySelector('#desk')!
  let window = new EventTarget(), time = clock()
  let posts: { name: string; value: Json }[] = [], went: string[] = []
  let bound: string[] = []
  let location = {
    hash,
    get href() {
      return AT + this.hash
    },
    assign: (url: string) => void went.push(url),
  }
  let fetch: Page['fetch'] = async (url, init) => {
    let name = url.pathname.split('/').pop()!
    let value = init?.body ? JSON.parse(String(init.body)) : undefined
    if (value) posts.push({ name, value })
    let answer = await (answers[name] ?? door[name] ?? (() => ({})))(
      value ?? { id: url.searchParams.get('id') },
    ) as Json
    return { ok: !answer?.error, json: () => Promise.resolve(answer) }
  }
  let back = lend(document)
  await start(root, {
    fetch,
    location: location as unknown as Location,
    history: {
      replaceState: (_data, _unused, to) => void (location.hash = String(to)),
    },
    window,
    recovery: () =>
      Promise.resolve({
        bind: (_form, place) => void bound.push(place),
        unbind: () => void bound.splice(0),
      }),
    // FormData's reading of a form of text fields and one select.
    read: (form) =>
      Object.fromEntries(
        Array.from(form.querySelectorAll('[name]'), (f) => [
          f.getAttribute('name'),
          f.localName == 'select'
            ? f.querySelector('option')!.getAttribute('value')
            : (f as HTMLInputElement).value,
        ]),
      ),
    after: time.after,
  })
  back()
  let field = (name: string) =>
    root.querySelector<HTMLInputElement>(`[name=${name}]`)!
  let pressable = (words: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button, a'))
      .find((b) => b.textContent == words)!
  return {
    document,
    root,
    time,
    posts,
    went,
    bound,
    location,
    field,
    pressable,
    sent: (name: string) =>
      posts.filter((p) => p.name == name).map((p) => p.value),
    said: () => root.querySelector('[role=status]')!.textContent,
    // A browser bubbles a field's input to its form. LinkeDOM calls a
    // listener there with the field as `this`, where preact looks for the
    // handler, so the form is given what would have reached it.
    type: (name: string, text: string) => {
      field(name).value = text
      field(name).closest('form')!.dispatchEvent(new Dom('input'))
    },
    // A press, and the form it sends where the button is its form's send.
    press: (words: string) => {
      let button = pressable(words)
      button.dispatchEvent(new Dom('click', { bubbles: true }))
      if (button.getAttribute('type') == 'submit') {
        button.closest('form')!.dispatchEvent(
          new Dom('submit', { bubbles: true, cancelable: true }),
        )
      }
      return tick()
    },
    go: (to: string) => {
      location.hash = to
      window.dispatchEvent(new Event('hashchange'))
      return tick()
    },
    account: () => {
      let link = document.querySelector('[data-account]')!
      link.dispatchEvent(new Dom('click', { bubbles: true }))
      return new URL(link.getAttribute('href')!)
    },
  }
}
type Desk = Awaited<ReturnType<typeof desk>>

// A case about the studio, at a desk already open.
let studio = (does: string, d: Desk, act: (d: Desk) => Promise<void>) =>
  test('the studio ' + does, () => {
    cleanup(lend(d.document))
    return act(d)
  })

studio(
  'signs in from the open book and comes back to it',
  await desk(),
  async (d) => {
    let fresh = d.account()
    equal(fresh.origin + fresh.pathname, 'https://yaks.app/login')
    equal(fresh.searchParams.get('return'), `${AT}#new/${NEW}`)
    equal(d.bound, ['book:' + NEW])
    await d.go('#book/b')
    equal(d.account().searchParams.get('return'), AT + '#book/b')
    equal(d.bound, ['book:b'])
  },
)

let a = held<Json>(), b = held<Json>()
studio(
  'keeps the latest book when older reads finish later',
  await desk(undefined, { book: ({ id }) => (id == 'a' ? a : b).promise }),
  async (d) => {
    d.go('#book/a')
    d.go('#book/b')
    b.resolve(row('b'))
    await tick()
    a.resolve(row('a'))
    await tick()
    equal(d.field('title').value, 'b')
  },
)

let next = held<Json>()
studio(
  'saves the visible book while the next book loads',
  await desk('#book/a', {
    book: ({ id }) => id == 'a' ? row('a') : next.promise,
  }),
  async (d) => {
    d.go('#book/b')
    await d.press('Save draft')
    next.resolve(row('b'))
    await tick()
    equal(d.sent('save')[0].id, 'a')
    equal(d.field('title').value, 'b')
  },
)

let saved = held<Json>()
studio(
  'prepares the saved book if another opens during its save',
  await desk('#book/a', { save: () => saved.promise }),
  async (d) => {
    d.press('Prepare book')
    await d.go('#book/b')
    saved.resolve(row('a'))
    await tick()
    equal(d.sent('prepare'), [{ id: 'a' }])
  },
)

studio(
  'saves typed words a pause after the last, as a draft and then as the book',
  await desk(),
  async (d) => {
    d.type('title', 'Moon')
    equal(d.said(), 'Saving…')
    await d.time.advance(399)
    d.type('markdown', '# One')
    await d.time.advance(399)
    equal(d.posts, [])
    await d.time.advance(1)
    await tick()
    let words = {
      title: 'Moon',
      author: '',
      markdown: '# One',
      dedication: '',
    }
    equal(d.sent('save'), [{ ...words, draft: NEW }])
    equal([d.said(), d.location.hash], ['Saved.', '#book/' + NEW])
    await d.press('Save draft')
    equal(d.sent('save')[1], { ...words, id: NEW })
  },
)

let first = held<Json>(), saves = [first.promise, row(NEW)]
studio(
  'sends one save at a time',
  await desk(undefined, { save: () => saves.shift() }),
  async (d) => {
    d.type('title', 'One')
    await d.time.advance(400)
    d.type('title', 'Two')
    await d.time.advance(400)
    equal(d.sent('save').map((s) => s.title), ['One'])
    first.resolve(row(NEW))
    await tick()
    equal(d.sent('save').map((s) => s.title), ['One', 'Two'])
  },
)

studio(
  'sends a save owed to the book being left',
  await desk('#book/a'),
  async (d) => {
    d.type('title', 'Kept')
    await d.go('#book/b')
    equal(d.sent('save'), [{
      title: 'Kept',
      author: '',
      markdown: 'Words from a',
      dedication: '',
      id: 'a',
    }])
  },
)

studio(
  'shelves saved books and starts a new one',
  await desk('', {
    shelf: () => [row('a'), row('b', prepared), row('c', { book_receipt: {} })],
  }),
  async (d) => {
    equal(
      Array.from(
        d.root.querySelectorAll('a[href^="#book/"]'),
        (a) => [a.getAttribute('href'), a.textContent],
      ),
      [
        ['#book/a', 'aSaved draft'],
        ['#book/b', 'bReady to review'],
        ['#book/c', 'cPrint order saved'],
      ],
    )
    equal(d.bound, [])
    await d.go('#new')
    match(d.location.hash, /^#new\/[a-f0-9-]{36}$/)
    equal(d.bound, ['book:' + d.location.hash.slice(5)])
  },
)

studio('offers a first book on an empty shelf', await desk(''), (d) => {
  equal(d.pressable('Start a book').getAttribute('href'), '#new')
  return Promise.resolve()
})

let quote = { currency: 'USD', total: 4210, shipping: 'MAIL', expires: 0 }
let quoted = row('a', prepared)
studio(
  'quotes a prepared book for its destination and follows its checkout',
  await desk('#book/a', {
    book: () => quoted,
    quote: () => (quoted = { ...quoted, book_quote: { quote } }, {}),
    purchase: () => ({ checkout: 'https://pay.test/a' }),
  }),
  async (d) => {
    equal(d.bound, ['book:a', 'shipping:a'])
    equal(
      d.root.querySelector('img')!.getAttribute('src'),
      './studio/file?id=a&blob=p1',
    )
    equal(
      d.pressable('Open cover PDF').getAttribute('href'),
      './studio/file?id=a&blob=co',
    )
    d.type('name', 'Ada')
    d.type('quantity', '2')
    await d.press('Get destination quote')
    equal(d.sent('quote'), [{
      id: 'a',
      quantity: 2,
      shipping: 'MAIL',
      address: {
        name: 'Ada',
        street1: '',
        street2: '',
        city: '',
        state_code: '',
        postcode: '',
        country_code: 'US',
        phone_number: '',
      },
    }])
    match(d.root.textContent, /\$42\.10/)
    await d.press('Continue to PrintBound checkout')
    equal([d.sent('purchase'), d.went], [[{ id: 'a' }], [
      'https://pay.test/a',
    ]])
  },
)

let progress = held<Json>()
studio(
  'holds a pressed button until its answer',
  await desk('#book/a', {
    book: () =>
      row('a', {
        ...prepared,
        book_receipt: { receipt: { status: 'printing' } },
      }),
    progress: () => progress.promise,
  }),
  async (d) => {
    let button = d.pressable('Refresh progress')
    await d.press('Refresh progress')
    equal(button.disabled, true)
    progress.resolve({})
    await tick()
    equal([button.disabled, d.sent('progress')], [false, [{ id: 'a' }]])
  },
)

let composing = row('a'), asked = 0
studio(
  'asks after a book being prepared until its pages are composed',
  await desk('#book/a', {
    book: () => composing,
    prepare: () => ({ pending: true }),
    preparation: () =>
      ++asked < 2 ? { pending: true } : (composing = row('a', prepared), {}),
  }),
  async (d) => {
    await d.press('Prepare book')
    equal([d.said(), asked], ['Preparing composed pages…', 1])
    await d.time.advance(1000)
    await tick()
    equal([asked, d.bound], [2, ['book:a', 'shipping:a']])
  },
)

let refusals = [{ error: 'Sign in to save.' }, { error: {} }]
studio(
  'says a refusal in its words, or that the text is kept',
  await desk(undefined, { save: () => refusals.shift() }),
  async (d) => {
    await d.press('Save draft')
    equal(d.said(), 'Sign in to save.')
    await d.press('Save draft')
    equal(d.said(), 'That could not finish. Your text is kept here.')
  },
)
