import { loadVocab, type Vocab } from '@yaks/vocab'
import type { Store, Subscribe } from './component.ts'

/** What a views module exports: its registry, named as a package's `/views`
 * facet names it. */
export type Views<R> = { views: R }

/** A write to the draft a preview page follows, as `yak-draft` tells it:
 * each file's path, the address it serves at, and its sha (null when the
 * write deleted it). */
export type Draft = {
  files: {
    path: string
    sha: string | null
    url?: string
    entries?: string[]
  }[]
}

/** What the page supplies: everything `entity` binds but the registry, the
 * element the page draws into, the address of its views module, and what to
 * draw there given the bound `Entity`. */
export type Binding = {
  vocab: Vocab
  store: Store
  subscribe?: Subscribe
  extend?: (next: Vocab) => boolean
}

export type Page<R, Render> =
  & (Binding | {
    client: {
      vocab: Vocab
      ent: Store
      extend: (next: Vocab) => boolean
      watch: (query: string) => {
        subscribe: (notify: () => void) => () => void
        close: () => void
      }
    }
  })
  & {
    root: Element
    views: string | URL
    draw: Render
    /** how a module is imported; `import()` by default */
    load?: (url: string) => Promise<Views<R>>
    /** The page vocabulary endpoint, relative to its base URI (default: api/vocab.json). */
    vocabulary?: string | URL
    /** How the vocabulary is fetched; the page's fetch by default. */
    fetch?: (url: string) => Promise<Response>
  }

/** A drawn page. */
export type Host<R> = {
  /** the registry drawn now */
  registry: () => R
  /** resolves once the newest write the host took is drawn, or given up */
  settled: () => Promise<void>
  /** stop following writes and empty the root */
  close: () => void
}

let path = (url: string) => new URL(url).pathname

/** The sha of the views module a write brings when the write is that module
 * alone; else null, and the page takes the write its own way (a stylesheet
 * swapped, or a reload). */
export let taken = (news: Draft, views: string): string | null => {
  let files = Array.isArray(news?.files) ? news.files : []
  let ours = files.length > 0 &&
    files.every((f) =>
      f.sha && (
        f.entries?.length
          ? f.entries.every((entry) => path(entry) == path(views))
          : f.url && path(f.url) == path(views)
      )
    )
  return ours ? files.at(-1)!.sha : null
}

/** Where the module a write brought is imported from: a new address for each
 * sha, so the browser imports it again. */
export let addressed = (views: string, sha: string): string => {
  let url = new URL(views)
  url.searchParams.set('yak-draft', sha)
  return String(url)
}

let registryOf = <R extends { renderers: readonly unknown[] }>(
  module: Views<R>,
) => {
  let views = module?.views
  if (!Array.isArray(views?.renderers)) {
    throw new Error('A views module exports `views`, a @yaks/render registry')
  }
  return views
}

// An element's place under the root: its id, or the child indices leading
// to it, which a redraw of the same shape gives back.
type Place = string | number[]
let placeOf = (root: Element, el: Element): Place => {
  if (el.id) return el.id
  let steps = []
  for (let at = el; at != root && at.parentElement; at = at.parentElement) {
    steps.unshift([...at.parentElement.children].indexOf(at))
  }
  return steps
}
let found = (root: Element, place: Place) =>
  typeof place == 'string'
    ? root.ownerDocument.getElementById(place)
    : place.reduce<Element | undefined>((at, i) => at?.children[i], root)

type Field = HTMLInputElement | HTMLTextAreaElement

// What a redraw may move, read before it: the window's scroll, each scrolled
// element's, and the focused element and its caret. The answer puts back
// whatever the redraw lost.
let kept = (root: Element) => {
  let doc = root.ownerDocument
  let win = doc.defaultView
  let [x, y] = [win?.scrollX ?? 0, win?.scrollY ?? 0]
  let scrolled = [...root.querySelectorAll('*')]
    .filter((el) => el.scrollTop || el.scrollLeft)
    .map((el) => [placeOf(root, el), el.scrollTop, el.scrollLeft] as const)
  let active = doc.activeElement as Field | null
  let focus = active && active != root && root.contains(active)
    ? placeOf(root, active)
    : null
  let caret = active && typeof active.selectionStart == 'number'
    ? [active.selectionStart, active.selectionEnd] as const
    : null
  return () => {
    for (let [place, top, left] of scrolled) {
      let el = found(root, place)
      if (el && (el.scrollTop != top || el.scrollLeft != left)) {
        el.scrollTop = top
        el.scrollLeft = left
      }
    }
    if (focus != null && !active!.isConnected) {
      let el = found(root, focus) as Field | null
      el?.focus?.({ preventScroll: true })
      if (caret && el?.setSelectionRange) el.setSelectionRange(...caret)
    }
    if (win && (win.scrollX != x || win.scrollY != y)) win.scrollTo?.(x, y)
  }
}

let binding = <R, Render>(page: Page<R, Render>): Binding => {
  if (!('client' in page)) return page
  let { client } = page
  return {
    vocab: client.vocab,
    store: client.ent,
    extend: client.extend,
    subscribe: (eid, notify) => {
      let watch = client.watch(`.entity.eid="${eid}"`)
      let off = watch.subscribe(notify)
      return () => {
        off()
        watch.close()
      }
    },
  }
}

/** Draw a page and follow its draft using the supplied renderer. */
export let host = async <R extends { renderers: readonly unknown[] }, Render>(
  page: Page<R, Render>,
  mount: (root: Element, binding: Binding, initial: R, view: Render) => {
    draw: (registry: R, vocab: Vocab) => void
    close: () => void
  },
): Promise<Host<R>> => {
  let { root, draw, load = (url) => import(url) } = page
  let views = String(new URL(page.views, root.ownerDocument.baseURI))
  let bound = binding(page)
  let words = bound.vocab
  let source = String(
    new URL(page.vocabulary ?? 'api/vocab.json', root.ownerDocument.baseURI),
  )
  let file = String(new URL('vocab.json', root.ownerDocument.baseURI))
  let current = registryOf<R>(await load(views))
  let surface = mount(root, bound, current, draw)
  let drawn = () => surface.draw(current, words)
  try {
    drawn()
  } catch (error) {
    surface.close()
    throw error
  }
  // Writes can land faster than their modules import; only the newest draws.
  let newest = 0
  let closed = false
  let last = Promise.resolve()
  let swap = async (sha: string, n: number) => {
    let next
    try {
      next = registryOf<R>(await load(addressed(views, sha)))
    } catch (e) {
      if (n == newest) throw e
      return
    }
    if (n != newest) return
    let old = current
    let restore = kept(root)
    current = next
    try {
      drawn()
    } catch (e) {
      current = old
      drawn()
      throw e
    } finally {
      restore()
    }
  }
  let heard = (event: Event) => {
    let news = (event as CustomEvent<Draft>).detail
    let files = Array.isArray(news?.files) ? news.files : []
    let vocab = files.filter((f) => f.url && path(f.url) == path(file))
    let modules = files.filter((f) => !vocab.includes(f))
    let sha = taken({ files: modules }, views)
    if ((!vocab.length && !sha) || (modules.length && !sha)) return
    if (vocab.length && (!bound.extend || vocab.some((f) => !f.sha))) return
    event.preventDefault()
    let reload = (event as Event & { reload?: () => void }).reload
    let n = sha ? ++newest : newest
    // A views write may follow a vocabulary write before its fetch finishes.
    // Keep their order so a new renderer always meets its new components.
    last = last.then(async () => {
      if (closed) return
      if (vocab.length) {
        let response = await (page.fetch ?? globalThis.fetch)(
          addressed(source, vocab.at(-1)!.sha!),
        )
        if (!response.ok) {
          throw new Error(`Vocabulary fetch: ${response.status}`)
        }
        let next = loadVocab(await response.json(), words.keywords)
        if (closed) return
        if (!bound.extend!(next)) {
          reload?.()
          return
        }
        words = next
      }
      if (sha) await swap(sha, n)
      else if (n == newest) {
        let restore = kept(root)
        try {
          drawn()
        } finally {
          restore()
        }
      }
    }).catch((e) => {
      console.error(e)
      reload?.()
    })
  }
  let win = root.ownerDocument.defaultView ?? globalThis
  win.addEventListener('yak-draft', heard)
  return {
    registry: () => current,
    settled: () => last,
    close: () => {
      closed = true
      newest++
      win.removeEventListener('yak-draft', heard)
      surface.close()
    },
  }
}
