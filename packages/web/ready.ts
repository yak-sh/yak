import { result } from '@yaks/ui/interaction'
import {
  DRAW,
  type Drawing,
  LEAVE,
  READY,
  sources,
  TAKES,
} from '@yaks/ui/navigate'
import { navigation } from './navigate.ts'
import { SCROLL, TURNS } from './picture.ts'

let HOME = '[data-site-home]'
let RUNS = /^(|module|text\/javascript|application\/javascript)$/
let WAIT = 10_000

let loaded = (at: HTMLElement, event: string, name: string) =>
  new Promise<void>((done, fail) => {
    at.addEventListener(event, () => done(), { once: true })
    at.addEventListener('error', () => fail(Error('Could not load ' + name)), {
      once: true,
    })
  })

let run = (old: HTMLScriptElement) => {
  let script = old.ownerDocument.createElement('script')
  for (let { name, value } of old.attributes) script.setAttribute(name, value)
  script.textContent = old.textContent
  let event = 'load'
  if (!script.src && script.type == 'module') {
    script.id ||= crypto.randomUUID()
    event = 'yak-script-ready'
    script.textContent += `\n;document.getElementById(${
      JSON.stringify(script.id)
    })?.dispatchEvent(new Event('${event}'))`
  }
  let began = script.src || script.type == 'module'
    ? loaded(script, event, script.src || 'the view')
    : undefined
  old.replaceWith(script)
  return began
}

// Run the view's scripts but those `ran` names, which the document ran
// before the view came.
let scripts = (view: HTMLElement, base: string, ran: Set<string>) => {
  let boot: Promise<void>[] = []
  for (let script of view.querySelectorAll('script')) {
    if (!RUNS.test(script.getAttribute('type') ?? '')) continue
    let src = script.getAttribute('src')
    if (src) {
      let at = new URL(src, base).href
      if (ran.has(at)) continue
      ran.add(at)
      script.src = at
    }
    let began = run(script)
    if (began) boot.push(began)
  }
  return Promise.all(boot)
}

/** Mount the signed-in frame as a view beside the current site page.
 *
 * The view is in the document at once: an empty frame, `aria-busy` with a
 * Loading line, drawn by the sheet Home and the workspace share. The page
 * `first` answers fills it once it and its stylesheets are in, and its
 * scripts boot after. A press before the scripts run draws in its own frame
 * whatever the view holds by then, the frame or the page, and moves the
 * address; a press after is the navigator's (@yaks/web/navigate). Where the
 * page cannot be had (signed out, another importmap, an error), a press
 * loads it instead.
 */
export let ready = (
  link: HTMLAnchorElement,
  to: string,
  first: Promise<Response | null>,
): ((input: Event) => Promise<void> | void) | undefined => {
  let win = globalThis.window
  let doc = link.ownerDocument
  let home = doc.querySelector<HTMLElement>(HOME)
  if (!home) return
  let at = new URL(to, win.location.href)
  let path = (url: URL | Location) => url.pathname + url.search
  let address = path(win.location)
  let base = doc.querySelector('base[href]')
  let homeBase = base?.getAttribute('href')
  let homeTitle = doc.title
  let workspaceTitle = homeTitle
  let view = doc.createElement('div')
  let busy = doc.createElement('p')
  busy.className = 'Loading'
  busy.setAttribute('role', 'status')
  busy.textContent = 'Loading…'
  view.className = 'Site_Workspace'
  view.setAttribute('data-site-frame', '')
  view.setAttribute('aria-busy', 'true')
  view.inert = true
  // The one inert is no part of the page's picture (@yaks/web/keep).
  view.setAttribute(TURNS, '')
  home.setAttribute(TURNS, '')
  view.append(busy)
  // Set the boundary before installing the workspace sheet. The public view
  // stays in its own layout while the workspace is built at viewport size.
  doc.body.setAttribute('data-site-views', '')
  doc.body.append(view)
  let assets: HTMLLinkElement[] = []
  let shown = () => !view.inert
  let visible = (workspace: boolean) => {
    if (view.inert == !workspace) return
    view.inert = !workspace
    home.inert = workspace
    // Home's base belongs to its published app. The frame's fragment links
    // point to its current address, including after a switch to Updates.
    if (workspace) base?.removeAttribute('href')
    else if (homeBase != null) base?.setAttribute('href', homeBase)
    if (workspace) doc.title = workspaceTitle
    else {
      workspaceTitle = doc.title
      doc.title = homeTitle
    }
    view.dispatchEvent(new win.Event('yak-viewed', { bubbles: true }))
  }
  // Show the view by a press of its own, before the navigator can.
  let show = () => {
    win.history.pushState(null, '', path(at))
    visible(true)
  }
  // Until the navigator runs, Back and Forward between Home and the view
  // are these.
  let popped = () =>
    path(win.location) == address
      ? visible(false)
      : path(win.location) == path(at) && visible(true)
  win.addEventListener('popstate', popped)

  let gone = false
  let discard = () => {
    gone = true
    win.removeEventListener('popstate', popped)
    if (view.isConnected) doc.dispatchEvent(new win.Event(LEAVE))
    view.remove()
    home.removeAttribute(TURNS)
    for (let asset of assets) asset.remove()
    doc.body.removeAttribute('data-site-views')
    link.removeAttribute(READY)
  }
  // The page is not to be had: a view a press showed loads it instead.
  let fail = (error?: unknown) => {
    if (gone) return
    if (error) win.reportError?.(error)
    let was = shown()
    discard()
    if (was) win.location.replace(at.href)
  }
  // A slow phase gets time to finish even when the phases before it were slow.
  let wait = <T>(pending: Promise<T>, phase: string): Promise<T> => {
    let timer: ReturnType<typeof win.setTimeout> | undefined
    let overdue = new Promise<never>((_, reject) => {
      timer = win.setTimeout(
        () => reject(Error(`The signed-in view timed out ${phase}`)),
        WAIT,
      )
    })
    return Promise.race([pending, overdue]).finally(() =>
      win.clearTimeout(timer)
    )
  }

  // The page and its sheets, in the view, and the scripts the document ran
  // before it; false where it is not to be had.
  let fill = async (): Promise<Set<string> | false> => {
    let response = await wait(first, 'getting the page')
    if (
      !response?.ok ||
      !response.headers.get('content-type')?.includes('text/html')
    ) return false
    let answered = new URL(response.url || to, win.location.href)
    if (
      answered.origin != win.location.origin ||
      answered.pathname.startsWith('/login')
    ) return false
    at = answered
    let page = new win.DOMParser().parseFromString(
      await wait(response.text(), 'reading the page'),
      'text/html',
    )
    if (!page.querySelector(`script[${TAKES}]`)) return false
    let map = (owner: Document) =>
      owner.querySelector('script[type=importmap]')?.textContent
    if (map(doc) != map(page)) return false
    // Discover the page's modules while its sheets load, as its own parser would.
    assets = [...page.querySelectorAll<HTMLLinkElement>(
      'link[rel=stylesheet][href], link[rel=modulepreload][href]',
    )].map((asset) => {
      let link = doc.importNode(asset, true)
      link.href = new URL(asset.getAttribute('href')!, answered).href
      return link
    })
    let styles = assets.filter((link) => link.rel == 'stylesheet').map((
      sheet,
    ) => loaded(sheet, 'load', sheet.href))
    doc.head.append(...assets)
    await wait(Promise.all(styles), 'loading stylesheets')
    if (gone) return false
    let nodes = [...page.body.childNodes].map((n) => doc.importNode(n, true))
    for (
      let script of page.head.querySelectorAll('script[data-frame-script]')
    ) {
      nodes.push(doc.importNode(script, true))
    }
    view.className = `Site_Workspace ${page.body.className}`
    view.removeAttribute('aria-busy')
    // Read before the view's own scripts are in the document, which would
    // count them as run.
    let ran = sources(doc)
    view.replaceChildren(...nodes)
    workspaceTitle = page.title
    if (shown()) {
      win.history.replaceState(null, '', path(at))
      doc.title = workspaceTitle
    }
    for (let pane of view.querySelectorAll<HTMLElement>(`[${SCROLL}="end"]`)) {
      pane.scrollTop = pane.scrollHeight
    }
    return ran
  }

  let go: ReturnType<typeof navigation> | undefined
  let boot = async () => {
    let ran = await fill()
    if (!ran) return fail()
    await wait(scripts(view, at.href, ran), 'starting scripts')
    if (gone) return
    win.removeEventListener('popstate', popped)
    doc.addEventListener(DRAW, (event) => {
      if (!view.isConnected) return
      let asked = (event as CustomEvent<Drawing>).detail
      let draw = asked.draw
      if (path(asked.to) == address) {
        asked.draw = () => visible(false)
        asked.focusAfterPaint = true
      } else if (draw) {
        asked.draw = () => {
          visible(true)
          draw()
        }
        asked.focusAfterPaint = true
      }
    })
    go = navigation(
      win,
      (a) => home.inert || !home.contains(a) || a.hasAttribute(READY),
    )
    link.href = at.href
    link.setAttribute(READY, '')
    win.addEventListener('storage', (event) => {
      if (event.key != 'yak:signed' || event.newValue || !view.isConnected) {
        return
      }
      if (view.inert) discard()
      else win.location.reload()
    })
  }
  boot().catch(fail)

  return (input) => {
    let began = Math.min(win.performance.now(), input.timeStamp)
    let pressed = result(doc, input)
    if (go) return go(at, false, pressed, began)
    if (gone) {
      pressed?.leaving()
      return win.location.assign(at.href)
    }
    if (!shown()) show()
    pressed?.drawn(0)
  }
}
