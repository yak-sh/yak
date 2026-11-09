import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { frames } from './public/frames.js'
import { pageScript } from './page-script.ts'
import { assets } from './binding-probe.ts'

let code = await Deno.readTextFile(
  new URL('./public/location.js', import.meta.url),
)
let served = await Promise.all([undefined, 'draft-link'].map(async (draft) => {
  let { tags } = await pageScript(
    assets(new URL('./public/', import.meta.url)),
    '/',
    1,
    {
      badge: null,
      draft,
    },
  )
  return parseHTML(tags).document.querySelectorAll('script')
}))

test('live and draft app shells serve the location reporter inline', () => {
  for (let scripts of served) {
    ok([...scripts].some((s) => s.textContent == code))
  }
})

let page = () => {
  let { document, Event } = parseHTML(
    '<html><body><section data-app=notes><a data-open href="https://ada.yaks.app/draft/" target="_blank">Open</a><input name=screen value=draft type=radio checked><input name=screen value=live type=radio>' +
      ['draft', 'live'].map((which) =>
        `<a data-address="${which}" target="_blank" href="https://ada.yaks.app/${which}/">https://ada.yaks.app/${which}/</a>` +
        `<iframe data-frame="${which}" src="https://ada.yaks.app/${which}/"></iframe>`
      ).join('') + '</section></body></html>',
  )
  let parent = new EventTarget()
  let send = (source: unknown, origin: string, data: unknown) => {
    let event = new MessageEvent('message', { origin, data })
    Object.defineProperty(event, 'source', { value: source })
    parent.dispatchEvent(event)
  }
  let make = (which: string) => {
    let frame = document.querySelector(`[data-frame=${which}]`)!
    let address = document.querySelector(
      `[data-address=${which}]`,
    ) as HTMLAnchorElement
    let listeners: Record<string, ((event: unknown) => void)[]> = {}
    let host = {
      postMessage: (data: unknown) =>
        send(source, which == 'draft' ? 'null' : location.origin, data),
    }
    let fire = (name: string, event: unknown = {}) =>
      listeners[name]?.forEach((fn) => fn(event))
    let source = {
      postMessage: (data: unknown) =>
        fire('message', { data, source: host, origin: 'https://yaks.app' }),
    }
    Object.defineProperty(frame, 'contentWindow', { value: source })
    let location = new URL('opened?q=tea#today', frame.getAttribute('src')!)
    let move = function (
      this: unknown,
      _data: unknown,
      _unused: string,
      url: string,
    ) {
      equal(this, history)
      location.href = new URL(url, location).href
      return 'moved'
    }
    let history = { pushState: move, replaceState: move }
    let load = () => {
      listeners = {}
      new Function(
        'globalThis',
        'location',
        'history',
        'addEventListener',
        code,
      )(
        { parent: host },
        location,
        history,
        (name: string, fn: (event: unknown) => void) =>
          (listeners[name] ??= []).push(fn),
      )
    }
    load()
    return { frame, address, source, location, history, fire, load }
  }
  let draft = make('draft'), live = make('live')
  let refresh = frames(parent as Window, document)
  let shown = (p: typeof live, at = p.location.href) => {
    equal(p.address.textContent, at)
    equal(p.address.getAttribute('href'), at)
    equal(p.address.target, '_blank')
  }
  return { document, Event, draft, live, send, shown, refresh }
}

let initial = page(),
  navigating = page(),
  guarded = page(),
  inserted = page(),
  switching = page()

test('a preview reports its initial address even when its shell loads before the Operator script', () => {
  let p = initial
  p.shown(p.live)
  p.shown(p.draft)
})

test('preview addresses follow history, hashes, back/forward and page links without changing their frame', () => {
  let p = navigating, app = p.live
  equal(
    app.history.pushState({ page: 1 }, '', '/live/records?q=tea#first'),
    'moved',
  )
  p.shown(app)
  app.history.replaceState(null, '', '?q=coffee#second')
  p.shown(app)
  for (
    let [at, event] of [
      ['/live/records?q=coffee#third', 'hashchange'],
      ['/live/', 'popstate'],
      ['/live/about/?q=hello#team', 'pageshow'],
    ]
  ) {
    app.location.href = new URL(at, app.location).href
    app.fire(event)
    p.shown(app)
  }
  // A link loads a fresh shell in the same cross-origin window.
  app.location.href = 'https://ada.yaks.app/live/contact.html#mail'
  app.load()
  p.shown(app)
  p.draft.history.pushState(null, '', 'records#draft')
  p.shown(p.draft)
  equal(app.frame.getAttribute('src'), 'https://ada.yaks.app/live/')
})

test('address reports must come from that frame and origin and name a URL on the same origin', () => {
  let p = guarded, app = p.live
  for (
    let [source, origin, href] of [
      [{}, 'null', 'https://ada.yaks.app/spoofed'],
      [{}, app.location.origin, 'https://ada.yaks.app/spoofed'],
      [app.source, 'null', 'https://ada.yaks.app/spoofed'],
      [app.source, 'https://evil.example', 'https://evil.example/phishing'],
      [app.source, app.location.origin, 'https://evil.example/phishing'],
      [app.source, app.location.origin, 'javascript:alert(1)'],
      [app.source, app.location.origin, '/relative'],
      [app.source, app.location.origin, null],
    ]
  ) {
    p.send(source, String(origin), { 'yak-location': href })
    p.shown(app)
    p.shown(p.draft)
  }
  p.send(p.draft.source, 'null', {
    'yak-location': 'https://evil.example/phishing',
  })
  p.shown(p.draft)
})

test('frames inserted after the Operator script ask their loaded shell for its address', () => {
  let p = inserted
  let frame = p.live.frame.cloneNode() as HTMLIFrameElement
  let asked: unknown[] = []
  Object.defineProperty(frame, 'contentWindow', {
    value: {
      postMessage: (...args: unknown[]) => asked.push(args),
    },
  })
  p.document.body.append(frame)
  frame.dispatchEvent(new p.Event('load', { bubbles: true }))
  equal(asked, [[{ 'yak-location': true }, 'https://ada.yaks.app']])
})

test('Open follows the visible frame’s address through navigation, switching and header redraws', () => {
  let p = switching
  let open = () => p.document.querySelector('[data-open]')!.getAttribute('href')
  equal(open(), p.draft.location.href)
  p.live.history.pushState(null, '', 'live-records#today')
  equal(open(), p.draft.location.href)
  p.draft.history.replaceState(null, '', 'draft-records?q=tea#today')
  equal(open(), p.draft.location.href)
  let pick = (which: string) => {
    for (let radio of p.document.querySelectorAll('[name=screen]')) {
      radio.toggleAttribute('checked', radio.getAttribute('value') == which)
    }
    p.document.querySelector(`[name=screen][value=${which}]`)!
      .dispatchEvent(new p.Event('change', { bubbles: true }))
  }
  pick('live')
  equal(open(), p.live.location.href)
  pick('draft')
  equal(open(), p.draft.location.href)
  let next = p.document.createElement('a')
  next.setAttribute('data-open', '')
  next.href = 'https://ada.yaks.app/draft/'
  p.document.querySelector('[data-open]')!.replaceWith(next)
  p.refresh()
  equal(open(), p.draft.location.href)
})
