/** The studio, running in a page: what the address names is read from the
 * worker and drawn (views.ts), and what a person types and presses is saved
 * through the worker's doors under `./studio/`. `#new/<id>` is a book not
 * saved yet, `#book/<id>` a saved one, and no hash the shelf.
 *
 * A draw puts every field back to what is saved, so it happens only when a
 * read answers; between draws the fields are the person's, kept by the
 * draft desk (recovery.ts) and saved a moment after each keystroke. What
 * the page stands in (its document, address and network) is handed in as
 * `World`, so the same code runs on a document in a test. */
import { h, render } from 'preact'
import { placed } from '../pages/chrome.ts'
import type { Ask, Recovering, Typed } from '../recovery.ts'
import type { Book, Leaf, Settings } from './rows.ts'
import { Page, type Studio } from './views.ts'

/** What a page stands in: a browser's own, and its draft desk. */
export type World =
  & Pick<
    typeof globalThis,
    'document' | 'location' | 'history' | 'fetch' | 'FormData'
  >
  & {
    addEventListener: (name: 'hashchange', heard: () => void) => void
    recovery: (
      request: Ask,
      report: (error: unknown) => void,
    ) => Promise<Recovering>
  }

let said = (error: unknown) => (error as Error).message || String(error)

/** Run the studio in `#app`, opening what the address names. An address
 * with `?prompt=` opens a new book on that idea and saves it at once. */
export let run = async (world: World): Promise<void> => {
  let { document, location, history, fetch, FormData, addEventListener } = world
  let app = document.querySelector('#app')!
  let $ = <T extends Element = HTMLElement>(selector: string) =>
    app.querySelector<T>(selector)
  let book: Book | null = null,
    pages: Leaf[] = [],
    settings: Settings | null = null,
    queued: Promise<unknown> = Promise.resolve(),
    saving: ReturnType<typeof setTimeout> | null = null,
    pageId: string | null = null,
    opening = 0,
    watching: ReturnType<typeof setTimeout> | undefined,
    recovering: Recovering
  let state: Studio = {
    place: placed(location.href, '/studio'),
    screen: 'opening',
    drawn: 0,
    settings,
    shelf: [],
    book,
    pages,
    idea: '',
    gather: null,
    notice: { text: '' },
  }
  let show = (next: Partial<Studio>) => {
    state = { ...state, ...next }
    render(h(Page, state), app)
  }
  let tell = (text: string) => show({ notice: { text } })
  let fail = (error: unknown) =>
    show({ notice: { text: said(error), negative: true } })
  let unsaved = () => {
    if (saving != null) clearTimeout(saving)
    saving = null
  }

  let freshId = () => {
    let id = location.hash.split('/')[1]
    if (!/^[a-f0-9-]{36}$/i.test(id ?? '')) {
      id = crypto.randomUUID()
      history.replaceState(null, '', '#new/' + id)
    }
    return id
  }
  let request: Ask = async (name, value) => {
    let response = await fetch(
      new URL('./studio/' + name, document.baseURI),
      value
        ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
        }
        : {},
    )
    // An answer that is not JSON is a failure too, said the same way.
    let body = await (async () => await response.json())().catch(() => null)
    if (!response.ok || body == null) {
      throw new Error(
        typeof body?.error === 'string' ? body.error : body?.error?.message ||
          'That could not finish. Your saved pages are kept.',
      )
    }
    return body
  }
  let filled = (form: Element) =>
    Object.fromEntries(new FormData(form as HTMLFormElement))
  let save = (): Promise<Book> => {
    let input = filled($('[data-source]')!),
      id = pageId,
      existing = book?.entity.eid
    let saved = queued.catch(() => {}).then(async () => {
      let saved: Book = await request('save', {
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
    queued = saved
    return saved
  }
  /** Draw the book as it is saved, an unsaved one starting from `idea`. */
  let draw = (idea = '') => {
    recovering.unbind()
    show({
      screen: 'book',
      drawn: state.drawn + 1,
      settings,
      book,
      pages,
      idea,
      gather: null,
    })
    let place = 'book:' + pageId
    recovering.bind($('[data-source]')!, place)
    recovering.field($<Typed>('[data-story-text]')!, place + ':body')
    for (let form of app.querySelectorAll<HTMLElement>('form[data-page]')) {
      recovering.bind(form, 'page:' + form.dataset.page)
    }
    let destination = $('[data-destination]')
    if (destination) recovering.bind(destination, 'shipping:' + pageId)
  }
  /** Carry the story into the idea's form, so one save sends both. */
  let carry = () => {
    let story = $<HTMLTextAreaElement>('[data-story-text]'),
      body = $<HTMLInputElement>('[data-source] [name=body]')
    if (story && body) body.value = story.value
  }
  let open = async (idea = '') => {
    let turn = ++opening
    if (saving != null && $('[data-source]')) {
      unsaved()
      carry()
      save().catch(fail)
    }
    settings ??= await request('settings')
    if (turn !== opening) return
    if (location.hash.startsWith('#new')) {
      pageId = freshId()
      book = null
      pages = []
      draw(idea)
      if (idea) {
        carry()
        await save().catch(fail)
      }
      return
    }
    if (location.hash.startsWith('#book/')) {
      let id = location.hash.slice(6)
      let value = await request('book?id=' + encodeURIComponent(id))
      if (turn !== opening) return
      pageId = id
      book = value.book as Book
      pages = value.pages
      draw()
      if (book.page_drawing || pages.some((p) => p.page_drawing)) watch(id)
      return
    }
    let shelf = await request('shelf')
    if (turn !== opening) return
    recovering.unbind()
    pageId = null
    show({ screen: 'shelf', drawn: state.drawn + 1, settings, shelf })
  }
  /** Read the book again shortly, and keep on while it is being drawn;
   * `begun` reads once more for a drawing only just asked for. */
  let watch = (id: string, begun = false) => {
    clearTimeout(watching)
    watching = setTimeout(async () => {
      if (pageId !== id) return
      try {
        let value = await request('book?id=' + id)
        let active = value.book.page_drawing ||
          value.pages.some((p: Leaf) => p.page_drawing)
        // Preserve edits in the current form while background artwork finishes.
        if (
          !saving && !document.activeElement?.matches('input,textarea,select')
        ) {
          book = value.book
          pages = value.pages
          draw()
        }
        if (active || begun) watch(id, false)
        else {
          tell(
            'Saved artwork progress is ready. Reopen this book to review it.',
          )
        }
      } catch (e) {
        fail(e)
      }
    }, 1500)
  }
  let pollStory = async (id: string) => {
    let result = await request('story', { id })
    if (result.pending) {
      setTimeout(() => pollStory(id).catch(fail), 1000)
      return
    }
    if (pageId === id) {
      tell('Your suggested story is saved. Edit anything before drawing.')
      await open()
    }
  }
  let preparation = async (id: string) => {
    let result = await request('preparation', { id })
    if (result.pending) {
      setTimeout(() => preparation(id).catch(fail), 1000)
      return
    }
    if (pageId === id) await open()
  }
  /** Make a book of a free page: a new coloring book holding its artwork. */
  let freebook = async () => {
    carry()
    let saved = await save(),
      original = await request('book?id=' + saved.entity.eid)
    let next = await request('save', {
      ...saved.coloring_book,
      title: saved.doc.title,
      body: '',
      mode: 'coloring',
    })
    await request('assemble', {
      id: next.entity.eid,
      pages: original.pages.filter((p: Leaf) => p.artwork).map((p: Leaf) =>
        p.entity.eid
      ),
    })
    location.hash = '#book/' + next.entity.eid
  }
  let connect = async () => {
    let response = await fetch('./api/service/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service: settings!.printer,
        operations: [
          'prepare',
          'document_status',
          'quote',
          'purchase',
          'order_status',
          'cancel',
          'document_file',
        ],
      }),
    })
    if (!response.ok) throw new Error(await response.text())
    tell('PrintBound is connected for the operations you selected.')
  }
  /** Do what a pressed button names in `data-act`. */
  let act = async (button: HTMLButtonElement) => {
    let { act, page, kind } = button.dataset,
      id = pageId!,
      hadPages = pages.length > 0
    if (['outline', 'draw', 'story', 'prepare'].includes(act!)) {
      carry()
      id = (await save()).entity.eid
    }
    if (act === 'choose') {
      let gather = await request('collection')
      if (pageId === id) show({ gather })
      return
    }
    if (act === 'freebook') return freebook()
    if (act === 'connect') return connect()
    if (act === 'retry' && page) {
      await request('edit', { ...filled(button.closest('form')!), id, page })
    }
    if (act === 'draw' && !hadPages) await request('outline', { id })
    if (act === 'puzzle') await request('puzzle', { id, activity: kind })
    else if (act === 'up' || act === 'down') {
      await request('move', { id, page, delta: act === 'up' ? -1 : 1 })
    } else {
      let result = await request(act!, { id, page })
      if (act === 'story' && result.pending) {
        tell('Writing a suggestion from your saved idea…')
        return pollStory(id)
      }
      if (act === 'prepare' && result.pending) {
        tell('Preparing composed pages…')
        return preparation(id)
      }
      if (act === 'purchase' && result.checkout) {
        return location.assign(result.checkout)
      }
    }
    await open()
    if (act === 'draw' && pageId === id) watch(id, true)
  }

  app.addEventListener('input', (event) => {
    let target = event.target as Element
    if (
      !target.closest('[data-source]') && !target.matches('[data-story-text]')
    ) return
    carry()
    unsaved()
    tell('Saving…')
    saving = setTimeout(() => {
      saving = null
      save().catch(fail)
    }, 400)
  })
  app.addEventListener('change', async (event) => {
    let target = event.target as HTMLInputElement
    if (!target.matches('[data-gallery]')) return
    try {
      await request('consent', { id: book!.entity.eid, agree: target.checked })
      tell('Your gallery choice is saved.')
    } catch (e) {
      fail(e)
    }
  })
  app.addEventListener('submit', async (event) => {
    event.preventDefault()
    unsaved()
    let form = event.target as HTMLFormElement
    try {
      if (form.matches('[data-source]')) {
        carry()
        await save()
        return
      }
      if (form.matches('[data-collection-form]')) {
        await request('assemble', {
          id: pageId,
          pages: [...new FormData(form).getAll('page')],
        })
      } else if (form.matches('[data-page]')) {
        await request('edit', {
          ...filled(form),
          id: book!.entity.eid,
          page: form.dataset.page,
        })
      } else {
        let { quantity, shipping, ...address } = filled(form)
        await request('quote', {
          id: book!.entity.eid,
          quantity: Number(quantity),
          shipping,
          address,
        })
      }
      await open()
    } catch (e) {
      fail(e)
    }
  })
  app.addEventListener('click', async (event) => {
    let target = event.target as Element
    // Signing in comes back to the book that is open.
    let account = target.closest<HTMLAnchorElement>('[data-account]')
    if (account) {
      let login = new URL('https://yaks.app/login')
      login.searchParams.set('return', location.href)
      account.href = login.href
      return
    }
    let button = target.closest<HTMLButtonElement>('[data-act]')
    if (!button) return
    button.disabled = true
    unsaved()
    try {
      await act(button)
    } catch (e) {
      fail(e)
    } finally {
      button.disabled = false
    }
  })
  addEventListener('hashchange', () => open().catch(fail))

  show({})
  try {
    recovering = await world.recovery(request, fail)
    let address = new URL(location.href),
      idea = address.searchParams.get('prompt')?.trim() ?? ''
    if (idea) {
      address.search = ''
      address.hash = '#new/' + crypto.randomUUID()
      history.replaceState(null, '', address.href)
    }
    await open(idea)
  } catch (e) {
    fail(e)
  }
}
