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
import { SCROLL } from './picture.ts'

let HOME = '[data-site-home]'
let RUNS = /^(|module|text\/javascript|application\/javascript)$/

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

let scripts = (doc: Document, view: HTMLElement, base: string) => {
  let ran = sources(doc)
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

let joined = (
  win: Window & typeof globalThis,
  home: HTMLElement,
  view: HTMLElement,
  title: string,
) => {
  let { document: doc } = win
  let address = win.location.pathname + win.location.search
  let base = doc.querySelector('base[href]')
  let homeBase = base?.getAttribute('href')
  let homeTitle = doc.title
  let workspaceTitle = title
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
  let find = (event: Event) => {
    if (!view.isConnected) return
    let asked = (event as CustomEvent<Drawing>).detail
    let draw = asked.draw
    if (asked.to.pathname + asked.to.search == address) {
      asked.draw = () => visible(false)
      asked.focusAfterPaint = true
    } else if (draw) {
      asked.draw = () => {
        visible(true)
        draw()
      }
      asked.focusAfterPaint = true
    }
  }
  doc.addEventListener(DRAW, find)
}

/** Mount the signed-in frame as a view beside the current site page. */
export let ready = async (
  link: HTMLAnchorElement,
  to: string,
  first: Promise<Response | null>,
): Promise<((input: Event) => Promise<void>) | undefined> => {
  let win = globalThis.window
  let doc = link.ownerDocument
  let home = doc.querySelector<HTMLElement>(HOME)
  if (!home) return
  let response = await first
  if (
    !response?.ok ||
    !response.headers.get('content-type')?.includes('text/html')
  ) return
  let at = new URL(response.url || to, win.location.href)
  if (at.origin != win.location.origin || at.pathname.startsWith('/login')) {
    return
  }
  let page = new win.DOMParser().parseFromString(
    await response.text(),
    'text/html',
  )
  if (!page.querySelector(`script[${TAKES}]`)) return
  let map = (owner: Document) =>
    owner.querySelector('script[type=importmap]')?.textContent
  if (map(doc) != map(page)) return
  let view = doc.createElement('div')
  view.className = `Site_Workspace ${page.body.className}`
  view.setAttribute('data-site-frame', '')
  view.inert = true
  for (let node of page.body.childNodes) view.append(doc.importNode(node, true))
  for (let script of page.head.querySelectorAll('script[data-frame-script]')) {
    view.append(doc.importNode(script, true))
  }
  // Set the boundary before installing the workspace sheet. The public view
  // stays in its own layout while the workspace is built at viewport size.
  doc.body.setAttribute('data-site-views', '')
  let sheets = [
    ...page.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]'),
  ]
    .map((sheet) => doc.importNode(sheet, true))
  let discarded = false
  let discard = () => {
    discarded = true
    if (view.isConnected) doc.dispatchEvent(new win.Event(LEAVE))
    view.remove()
    for (let sheet of sheets) sheet.remove()
    doc.body.removeAttribute('data-site-views')
    link.removeAttribute(READY)
  }
  let timeout: number | undefined
  try {
    let prepare = async () => {
      let styles = sheets.map((sheet) => loaded(sheet, 'load', sheet.href))
      doc.head.append(...sheets)
      await Promise.all(styles)
      if (discarded) return
      let boot = scripts(doc, view, at.href)
      doc.body.append(view)
      await boot
    }
    await Promise.race([
      prepare(),
      new Promise<never>((_, fail) => {
        timeout = win.setTimeout(
          () => fail(Error('The signed-in view did not start')),
          10_000,
        )
      }),
    ])
  } catch (error) {
    discard()
    throw error
  } finally {
    win.clearTimeout(timeout)
  }
  for (let pane of view.querySelectorAll<HTMLElement>(`[${SCROLL}="end"]`)) {
    pane.scrollTop = pane.scrollHeight
  }
  joined(win, home, view, page.title)
  let go = navigation(
    win,
    (a) => home.inert || !home.contains(a) || a.hasAttribute(READY),
  )
  link.href = at.href
  link.setAttribute(READY, '')
  win.addEventListener('storage', (event) => {
    if (event.key != 'yak:signed' || event.newValue || !view.isConnected) return
    if (view.inert) discard()
    else win.location.reload()
  })
  return (input) =>
    go(
      at,
      false,
      result(doc, input),
      Math.min(win.performance.now(), input.timeStamp),
    )
}
