/**
 * A space's Settings, Domains and Trash pages in the browser (D-475 step 5).
 * Each is drawn from the space's rows (./space-pages-view.ts), and here it
 * is drawn again from the tab's page graph as they move: a name or a logo
 * changed in another tab, a domain attached by the Operator, an app put in
 * the trash. Its writes go through the graph (./space-pages.ts): Settings'
 * Save bar writes `spaceSettings`, Remove logo writes it with `logo: null`,
 * Restore writes `restoreBinned`, and a domain's Save, Make included domain
 * and Offer transfer write `pointDomain`, `chooseDomain` and `offerDomain`,
 * each saying what it came to where it was pressed. A search watches the
 * registrar's offers for what was typed (`domainOffers`); Buy and Renew go to
 * the payment provider's checkout.
 *
 * The view is `[data-view="space-page"]`, saying what it draws for in
 * `data-space-view` (`SpaceView`).
 *
 * @module
 */
import { createElement as h, Fragment } from 'react'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client, Watch } from '@yaks/client'
import { mint } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { result } from '@yaks/ui/interaction'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { refusal } from './account-browser.ts'
import type { Notes } from './domain-pages.ts'
import { pageGraph } from './page-graph.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import { managePath } from './routes.ts'
import { sideApps, sideWords } from './side-rows.ts'
import {
  domainOffers,
  settingsEid,
  settingsOf,
  type SettingsWrite,
  spaceDomains,
  spacePagesWords,
  spaceSettings,
  spaceTrash,
} from './space-pages.ts'
import {
  type Held,
  heldRows,
  spacePageView,
  type SpaceView,
} from './space-pages-view.ts'

/** A space's Settings, Domains or Trash view. */
export let VIEW = '[data-view="space-page"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from the rows `held`; nothing until each is in. */
export let drawSpace = (
  root: HTMLElement,
  view: SpaceView,
  held: Held,
): void => {
  let rows = heldRows(view, held)
  if (!rows) return
  let next = root.cloneNode(false) as HTMLElement
  let t = root.ownerDocument.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, spacePageView(view, rows)))
  next.append(t.content)
  morph(root, next, KEPT)
}

// What a settings form holding `body` changes of the space.
let settingsFrom = (body: FormData): SettingsWrite => ({
  ...body.has('title') ? { title: String(body.get('title')).trim() } : {},
  ...body.has('space')
    ? { slug: String(body.get('space')).trim().toLowerCase() }
    : {},
  ...body.has('home') ? { home: String(body.get('home')) } : {},
  ...body.has('byline') ? { byline: body.getAll('byline').includes('on') } : {},
})

// Each of a domain's own writes: the form's field naming the domain, the
// act it writes, the key its note is said under, and what it writes from
// the form.
let DOMAIN_WRITES: [
  string,
  string,
  string,
  (form: Record<string, string>) => Record<string, string>,
][] = [
  ['point_domain', 'pointDomain', 'point', (f) => ({
    destination: f.destination ?? '',
  })],
  ['choose_domain', 'chooseDomain', 'choose', () => ({})],
  ['transfer_domain', 'offerDomain', 'transfer', (f) => ({
    to: (f.receiving_space ?? '').trim().toLowerCase(),
  })],
]

// What a form holds, by name: a box or a radio only when it is ticked.
let valuesOf = (form: HTMLFormElement): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let el of form.querySelectorAll<HTMLInputElement>('[name]')) {
    if ((el.type == 'checkbox' || el.type == 'radio') && !el.checked) continue
    out[el.getAttribute('name')!] = el.value
  }
  return out
}

/** How long typing rests before a search asks the registrar. */
export let RESTS = 325

/** Keep the space page `root` drawn from `graph`, and write through it. The
 * answer lets go of it all. */
export let bindSpace = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
  go: (to: string) => void = (to) => location.assign(to),
): () => void => {
  let view = JSON.parse(root.dataset.spaceView!) as SpaceView
  let space = view.space
  let doc = root.ownerDocument
  let watches: Record<string, Watch> = {
    settings: graph.watch(spaceSettings(space)),
    apps: graph.watch(sideApps(space)),
    ...view.page == 'domains'
      ? { page: graph.watch(spaceDomains(space)) }
      : view.page == 'trash'
      ? { page: graph.watch(spaceTrash(space)) }
      : {},
  }
  let offers: Watch | undefined
  let offersOff: (() => void) | undefined
  let state = {
    query: root.querySelector<HTMLInputElement>('#domain-query')?.value
      .trim() ?? '',
    notes: {} as Notes,
    restoring: new Set<string>(),
  }
  let draw = () => {
    drawSpace(root, view, {
      settings: watches.settings.value,
      apps: watches.apps.value,
      page: watches.page?.value,
      offers: offers?.value,
      ...state,
    })
    for (let form of root.querySelectorAll<SavingForm>('form[data-save]')) {
      form[SAVE_THROUGH] = save
    }
  }
  let say = (key: string, words: string, refused = false) => {
    state.notes = { ...state.notes, [key]: { words, refused } }
    draw()
  }
  let unsay = (key: string) => {
    let { [key]: _, ...rest } = state.notes
    state.notes = rest
  }
  let lost = 'Your changes could not be saved. They are kept here. Try again.'
  let write = async (bundles: Bundle[], unreached: string) => {
    try {
      return await graph.mutate(bundles)
    } catch (error) {
      throw new CallError('arguments', refusal(error, unreached))
    }
  }
  // Settings' Save bar: the space's settings, and on a new address, the page
  // there.
  let save = async (body: FormData) => {
    let was = settingsOf(watches.settings.value)?.slug
    let set = settingsFrom(body)
    await write([{
      entity: { eid: settingsEid(space) },
      spaceSettings: { space, ...set },
    }], lost)
    let slug = settingsOf(watches.settings.value)?.slug ?? set.slug
    return slug && slug != was ? { to: managePath(view.page, slug) } : undefined
  }
  // An act on the page, said where it was pressed under `key`.
  let act = async (key: string, bundle: Bundle, word: string) => {
    unsay(key)
    let [done] = await write([bundle], 'That did not go through. Try again.')
    let said = (done?.[word] as { said?: string } | undefined)?.said
    say(key, said ?? 'Saved.')
  }
  let click = async (e: Event) => {
    let target = e.target as Element
    let restore = target.closest<HTMLButtonElement>('[data-restore]')
    let unlogo = target.closest<HTMLButtonElement>('[data-unlogo]')
    let [key, item] = restore
      ? ['trash', restore.dataset.restore!]
      : unlogo
      ? ['logo', '']
      : []
    if (!key) return
    if (item) state.restoring.add(item)
    unsay(key)
    draw()
    try {
      if (item) {
        await act(key, {
          entity: { eid: mint() },
          restoreBinned: { space, item },
        }, 'restoreBinned')
      } else {
        await write([{
          entity: { eid: settingsEid(space) },
          spaceSettings: { space, logo: null },
        }], lost)
      }
    } catch (error) {
      say(key, (error as Error).message, true)
    }
    if (item) state.restoring.delete(item)
    draw()
  }
  let submit = async (e: Event) => {
    let form = e.target as HTMLFormElement
    if (form.matches('[data-domain-search]')) {
      e.preventDefault()
      return search(state.query = field()?.value.trim() ?? '', e)
    }
    if (form.matches('[data-domain-buy]')) {
      e.preventDefault()
      return await buy(form, e)
    }
    let fields = valuesOf(form)
    let mine = DOMAIN_WRITES.find(([field]) => field in fields)
    if (!mine) return
    e.preventDefault()
    let [held, word, key, rest] = mine
    let name = fields[held]
    let pressed = result(doc, e)
    let began = performance.now()
    let button = form.querySelector<HTMLButtonElement>('button[type=submit]')
    if (button) button.disabled = true
    try {
      await act(`${key}:${name}`, {
        entity: { eid: mint() },
        [word]: { space, name, ...rest(fields) },
      }, word)
    } catch (error) {
      say(`${key}:${name}`, (error as Error).message, true)
    }
    if (button) button.disabled = false
    pressed?.drawn(performance.now() - began)
  }
  let field = () => root.querySelector<HTMLInputElement>('#domain-query')
  // The registrar's offers for `query`, watched until another is asked.
  let search = (query: string, input?: Event) => {
    offersOff?.()
    offers?.close()
    offers = offersOff = undefined
    unsay('search')
    if (query) {
      let pressed = input && result(doc, input)
      let began = performance.now()
      offers = graph.watch(domainOffers(query))
      offersOff = offers.subscribe(() => {
        draw()
        if (offers?.value.length) pressed?.drawn(performance.now() - began)
      })
    }
    draw()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let typed = (e: Event) => {
    if ((e.target as Element).id != 'domain-query') return
    clearTimeout(timer)
    state.query = field()!.value.trim()
    timer = setTimeout(() => search(state.query), RESTS)
  }
  // Buy opens the payment provider's checkout, which the page leaves for.
  let buy = async (form: HTMLFormElement, e: Event) => {
    let pressed = result(doc, e)
    let button = form.querySelector<HTMLButtonElement>('button[type=submit]')!
    button.disabled = true
    say('search', 'Opening checkout…')
    try {
      let r = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { accept: 'application/json' },
      })
      let out = await r.json()
      if (r.ok) {
        pressed?.cancel()
        return go(out.url)
      }
      say(
        'search',
        out.error?.message ?? 'That did not go through. Try again.',
        true,
      )
    } catch {
      say('search', 'That did not go through. Try again.', true)
    }
    button.disabled = false
    pressed?.cancel()
  }
  let all = Object.values(watches)
  let off = all.map((w) => w.subscribe(draw))
  root.addEventListener('click', click)
  root.addEventListener('submit', submit)
  root.addEventListener('input', typed)
  if (state.query) search(state.query)
  draw()
  return () => {
    clearTimeout(timer)
    root.removeEventListener('click', click)
    root.removeEventListener('submit', submit)
    root.removeEventListener('input', typed)
    offersOff?.()
    offers?.close()
    for (let stop of off) stop()
    for (let w of all) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.spaceView!) as SpaceView
      let stop = bindSpace(
        root,
        pageGraph([sideWords, spacePagesWords], person),
      )
      leaving(doc).addEventListener('abort', () => {
        bound.delete(root)
        stop()
      }, { once: true })
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
