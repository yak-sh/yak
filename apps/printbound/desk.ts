/** The studio's desk at work: it opens the shelf or the book the address
 * names, saves a book's words a moment after they are typed, prepares it,
 * asks what sending it costs and buys it, through the studio's door
 * (`./studio/<name>`, ./storefront.ts). What it draws is ./sheets.ts.
 *
 * A form on the desk is the browser's own, never a copy of it in state: the
 * draft desk (./recovery.js) binds its fields and writes what it kept into
 * them, and a save reads them as they stand. So a draw sets a sheet's fields,
 * afresh each time, and nothing between two draws touches them.
 *
 * @module
 */

import { type ComponentChild, Fragment, h, render } from 'preact'
import { Book, type Does, type Row, Said, Shelf } from './sheets.ts'

type Typed = Record<string, unknown>
type Asked = <T = unknown>(name: string, value?: object) => Promise<T>

/** The draft desk's hold on the forms drawn: `bind` keeps a form's fields
 * under a place, `unbind` lets go of every one. */
export type Recovering = {
  bind: (form: Element, place: string) => void
  unbind: () => void
}

/** What the desk takes from the page it runs in. */
export type Page = {
  fetch: (
    url: URL,
    init?: RequestInit,
  ) => Promise<Pick<Response, 'ok' | 'json'>>
  location: Pick<Location, 'hash' | 'href' | 'assign'>
  history: Pick<History, 'replaceState'>
  /** where a change of the address is heard */
  window: Pick<EventTarget, 'addEventListener'>
  /** the draft desk, opened over the studio's door (./recovery.js) */
  recovery: (
    request: Asked,
    report: (error: Error) => void,
  ) => Promise<Recovering>
  /** a form's fields as they stand; the browser's FormData by default */
  read?: (form: HTMLFormElement) => Typed
  /** set a timer, returning what cancels it; setTimeout by default */
  after?: (ms: number, run: () => void) => () => void
}

let KEPT = 'That could not finish. Your text is kept here.'
/** How long after a typed word its save is sent, in ms. */
let PACE = 400
/** How long a book being prepared waits to be asked after again, in ms. */
let POLL = 1000

let fields = (form: HTMLFormElement): Typed =>
  Object.fromEntries(new FormData(form))

let timer = (ms: number, run: () => void) => {
  let set = setTimeout(run, ms)
  return () => clearTimeout(set)
}

// Ask the studio's door, posting `value` where there is one. A refusal
// throws its words.
let asking =
  (fetch: Page['fetch'], base: string): Asked => async (name, value) => {
    let response = await fetch(
      new URL('./studio/' + name, base),
      value
        ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
        }
        : {},
    )
    let body = await response.json()
    if (!response.ok) {
      throw new Error(
        typeof body.error === 'string'
          ? body.error
          : body.error?.message || KEPT,
      )
    }
    return body
  }

// Signing in comes back to the book that is open.
let returning = (document: Document, location: Page['location']) => {
  let account = document.querySelector<HTMLAnchorElement>('[data-account]')
  account?.addEventListener('click', () => {
    let login = new URL('https://yaks.app/login')
    login.searchParams.set('return', location.href)
    account.href = login.href
  })
}

/** Start the desk in `root`, and resolve once its first page is drawn. */
export let start = async (root: Element, page: Page) => {
  let { location, history } = page
  let after = page.after ?? timer, read = page.read ?? fields
  let request = asking(page.fetch, root.ownerDocument.baseURI)
  returning(root.ownerDocument, location)

  let book: Row | null = null, pageId: string | null = null, opening = 0
  let recovering: Recovering

  // The sheet is the one node from its draw to the next, so a line said in
  // between repaints the line alone and leaves every field as typed.
  let sheet: ComponentChild = null, said = { text: '', bad: false }, drawn = 0
  let paint = () => render(h(Fragment, {}, sheet, h(Said, said)), root)
  let tell = (text: string, bad = false) => {
    said = { text, bad }
    paint()
  }
  let fail = (error: Error) => tell(error.message, true)
  let show = (next: ComponentChild) => {
    sheet = next
    paint()
  }

  let form = (name: string) =>
    root.querySelector<HTMLFormElement>(`[data-${name}]`)
  let draw = () => {
    recovering.unbind()
    show(h(Book, { key: ++drawn, book, on }))
    recovering.bind(form('source')!, 'book:' + pageId)
    let destination = form('destination')
    if (destination) recovering.bind(destination, 'shipping:' + pageId)
  }
  let shelve = (rows: Row[]) => {
    recovering.unbind()
    pageId = null
    show(h(Shelf, { key: ++drawn, rows }))
  }
  let place = (id: string, row: Row | null) => {
    pageId = id
    book = row
    draw()
  }

  let freshId = () => {
    let id = location.hash.split('/')[1]
    if (!/^[a-f0-9-]{36}$/i.test(id ?? '')) {
      id = crypto.randomUUID()
      history.replaceState(null, '', '#new/' + id)
    }
    return id
  }

  // Saves go one at a time, each sending the fields as they stood when it
  // was asked for, under the book they were typed in.
  let queued: Promise<unknown> = Promise.resolve()
  let save = (): Promise<Row> => {
    let input = read(form('source')!), id = pageId, existing = book?.entity.eid
    let kept = queued.catch(() => {}).then(async () => {
      let saved = await request<Row>('save', {
        ...input,
        ...(existing ? { id } : { draft: id }),
      })
      if (pageId === id) {
        book = saved
        if (location.hash.startsWith('#new/')) {
          history.replaceState(null, '', '#book/' + id)
        }
        tell('Saved.')
      }
      return saved
    })
    queued = kept
    return kept
  }

  // The save a typed word is owed, until it is sent or something sends first.
  let paced: (() => void) | null = null
  let drop = () => {
    paced?.()
    paced = null
  }
  let typed = () => {
    drop()
    tell('Saving…')
    paced = after(PACE, () => {
      paced = null
      save().catch(fail)
    })
  }

  // The latest opening wins: an answer that arrives after a newer one was
  // asked for is dropped.
  let open = async () => {
    let turn = ++opening, hash = location.hash
    if (paced && form('source')) {
      drop()
      save().catch(fail)
    }
    if (hash.startsWith('#new')) return place(freshId(), null)
    let id = hash.startsWith('#book/') ? hash.slice(6) : null
    let answered = await (id
      ? request<Row>('book?id=' + encodeURIComponent(id))
        .then((row) => () => place(id, row))
      : request<Row[]>('shelf').then((rows) => () => shelve(rows)))
    if (turn === opening) answered()
  }

  let preparation = async (id: string): Promise<void> => {
    let result = await request<{ pending?: boolean }>('preparation', { id })
    if (result.pending) {
      after(POLL, () => preparation(id).catch(fail))
      return
    }
    if (pageId === id) await open()
  }

  let sent =
    (send: (form: HTMLFormElement) => Promise<unknown>) =>
    async (event: Event) => {
      event.preventDefault()
      drop()
      try {
        await send(event.currentTarget as HTMLFormElement)
      } catch (error) {
        fail(error as Error)
      }
    }
  // A pressed button waits for what it asked before it can be pressed again.
  let pressed = (act: () => Promise<unknown>) => async (event: Event) => {
    let button = event.currentTarget as HTMLButtonElement
    button.disabled = true
    drop()
    try {
      await act()
    } catch (error) {
      fail(error as Error)
    } finally {
      button.disabled = false
    }
  }
  let acted = (name: string) =>
    pressed(async () => {
      let result = await request<{ checkout?: string }>(name, {
        id: book!.entity.eid,
      })
      if (name === 'purchase' && result.checkout) {
        location.assign(result.checkout)
      } else await open()
    })

  let on: Does = {
    typed,
    keep: sent(save),
    prepare: pressed(async () => {
      let id = (await save()).entity.eid
      let result = await request<{ pending?: boolean }>('prepare', { id })
      if (!result.pending) return open()
      tell('Preparing composed pages…')
      await preparation(id)
    }),
    quote: sent(async (form) => {
      let { quantity, shipping, ...address } = read(form)
      await request('quote', {
        id: book!.entity.eid,
        quantity: Number(quantity),
        shipping,
        address,
      })
      await open()
    }),
    purchase: acted('purchase'),
    progress: acted('progress'),
    cancel: acted('cancel'),
  }

  recovering = await page.recovery(
    request,
    (error) => tell(error.message || String(error), true),
  )
  page.window.addEventListener('hashchange', () => open().catch(fail))
  await open().catch(fail)
}
