import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { DRAW, type Drawing } from '@yaks/ui/navigate'
import { switching } from './talk-views-browser.ts'
import { PART, type TalkView, VIEW, VIEWED } from './talk-views.ts'
import { type Heard, pageTalk } from './operator-talk-browser.ts'
import { operatorTalk } from './operator-talk.ts'
import { graph } from './page-graph_fixture_test.ts'
import { CANVAS_CHANGED, type CanvasChoice, SLOT } from './app-canvas-view.ts'
import { released, view as canvas } from './app-canvas_fixture_test.ts'
import { bindCanvas } from './app-canvas-browser.ts'

let view = (here: string, title: string, more: Partial<TalkView> = {}) =>
  JSON.stringify(
    {
      here,
      link: here,
      title,
      page: `${title} · Otto · yaks.app`,
      skip: ['#content', 'Skip to content'],
      aside: false,
      all: false,
      marks: [],
      ...more,
    } satisfies TalkView,
  ).replaceAll('"', '&quot;')

// An Operator page opened at its conversation, its Updates standing hidden.
let page = (appLinks = false) => {
  let { app, ...scope } = canvas(released())
  let attr = (value: unknown) => JSON.stringify(value).replaceAll('"', '&quot;')
  let { document } = parseHTML(`<html><head><title>Chat · Otto</title></head>
<body><a class="Skip" href="#ask">Skip to the message box</a><div class="Talk">
<aside id="menu" data-side-view="{&quot;talk&quot;:{&quot;all&quot;:false}}">
<form data-side><input name="back" value="/club"></form>
<a class="SideNav_Link SideNav_Link-on" aria-current="page" href="/club">Otto</a>
<a class="SideNav_Link" href="/club/updates">Updates</a>
${
    appLinks
      ? `<a href="/club?app=recipes" data-side-app="${attr(app)}">Recipes</a>`
      : ''
  }
</aside>
<div class="Frame_Bar"><b data-title>Chat</b><div class="Frame_AsideTools"></div></div>
<div id="content">
<section ${VIEW}="${
    view('/club', 'Chat', {
      skip: ['#ask', 'Skip to the message box'],
      aside: true,
    })
  }"><div data-conversation><p>chat</p></div><form id="ask"><textarea></textarea></form></section>
<section ${VIEW}="${
    view('/club/updates', 'Updates')
  }" hidden><p>news</p></section>
<section ${VIEW}="${
    view('/club/updates?dismissed', 'Updates', { snapshot: true })
  }" hidden><p>old archive</p></section>
</div><aside id="aside"></aside>
${
    appLinks
      ? `<template ${SLOT}="${attr({ ...scope, here: '/club' })}"></template>`
      : ''
  }
</div></body></html>`)
  let doc = document as unknown as Document
  if (!appLinks) switching(doc)
  return doc
}

// What the page draws of `path` itself, drawn.
let press = (doc: Document, path: string) => {
  let asked: Drawing = { to: new URL(path, 'https://y.test') }
  doc.dispatchEvent(new (doc.defaultView!.CustomEvent)(DRAW, { detail: asked }))
  asked.draw?.()
  return !!asked.draw
}

let shown = (doc: Document) => ({
  view: [...doc.querySelectorAll(`[${VIEW}]:not([hidden]) p`)].map((p) =>
    p.textContent
  ),
  title: doc.title,
  bar: doc.querySelector('[data-title]')?.textContent,
  lit: [...doc.querySelectorAll('[aria-current="page"]')].map((a) =>
    a.getAttribute('href')
  ),
  skip: doc.querySelector('a.Skip')?.getAttribute('href'),
  aside: !doc.getElementById('aside')?.hidden,
  back: (doc.querySelector('input[name=back]') as HTMLInputElement).value,
})

test('a press on another view of the page shows it in place, named, lit, and its aside put by', () => {
  let doc = page()
  equal(press(doc, '/club/updates'), true)
  equal(shown(doc), {
    view: ['news'],
    title: 'Updates · Otto · yaks.app',
    bar: 'Updates',
    lit: ['/club/updates'],
    skip: '#content',
    aside: false,
    back: '/club/updates',
  })
  equal(
    doc.querySelector('.SideNav_Link-on')?.getAttribute('href'),
    '/club/updates',
  )
  press(doc, '/club')
  equal(shown(doc).view, ['chat'])
  equal(shown(doc).aside, true)
})

test('reopening an Updates archive lets navigation fetch it again', () => {
  let doc = page()
  equal(press(doc, '/club/updates?dismissed'), false)
  equal(shown(doc).view, ['chat'])
})

test('each view keeps where it was scrolled', () => {
  let doc = page()
  let body = doc.getElementById('content')!
  body.scrollTop = 40
  press(doc, '/club/updates')
  equal(body.scrollTop, 0, 'a view never shown opens at its top')
  body.scrollTop = 7
  press(doc, '/club')
  equal(body.scrollTop, 40)
  press(doc, '/club/updates')
  equal(body.scrollTop, 7)
})

test('a view hears it was shown after the frame that shows it, not in the press', () => {
  let doc = page()
  // This document's own window, its frames run when the test says.
  let later: (() => void)[] = []
  let real = doc.defaultView!
  Object.defineProperty(doc, 'defaultView', {
    value: {
      Event: real.Event,
      CustomEvent: real.CustomEvent,
      requestAnimationFrame: (fn: () => void) => later.push(fn),
      setTimeout: (fn: () => void) => later.push(fn),
    },
  })
  let heard: string[] = []
  for (let v of doc.querySelectorAll(`[${VIEW}]`)) {
    v.addEventListener(
      VIEWED,
      () => heard.push(v.querySelector('p')!.textContent!),
    )
  }
  press(doc, '/club/updates')
  equal([shown(doc).view, heard], [['news'], []])
  while (later.length) later.shift()!()
  equal(heard, ['chat', 'news'])
})

test('an address the page holds no view of is left to the navigator', () => {
  let doc = page()
  equal(press(doc, '/club?app=packing'), false)
  equal(press(doc, '/updates?in=club'), false)
  equal(shown(doc).view, ['chat'])
})

test('opening an app shows its shell before mounting its frame and keeps the chat and its draft', () => {
  let doc = page(true)
  let g = graph(() => Promise.resolve([]))
  let opening: HTMLElement | undefined
  let stop: (() => void) | undefined
  switching(doc, (old, root) => {
    if (old) stop?.()
    opening = root
  })
  let choices: CanvasChoice[] = []
  doc.addEventListener(
    CANVAS_CHANGED,
    (e) => choices.push((e as CustomEvent<CanvasChoice>).detail),
  )
  let conversation = doc.querySelector('[data-conversation]')
  let text = doc.querySelector('textarea')!
  text.value = 'Keep my draft'
  equal(press(doc, '/club?app=recipes'), true)
  equal(
    doc.querySelector('[data-app]')?.getAttribute('aria-label'),
    'Recipe box',
  )
  equal(doc.querySelector('iframe'), null)
  equal(doc.querySelector('[data-side-open]')?.textContent, 'Open')
  equal(doc.querySelector('.Talk_Show')?.getAttribute('href'), '#app')
  equal(doc.querySelector('[data-conversation]') === conversation, true)
  equal(doc.querySelector('textarea') === text, true)
  equal(text.value, 'Keep my draft')
  stop = bindCanvas(opening!, g)
  equal(
    doc.querySelector('iframe')?.getAttribute('src'),
    'https://plum.yaks.app/recipes/',
  )
  equal(choices.map(({ here, app }) => [here, app?.slug]), [[
    '/club?app=recipes',
    'recipes',
  ]])
  equal(press(doc, '/club/updates'), true)
  equal(doc.querySelector('[data-app], .Talk_Show, [data-side-open]'), null)
  equal(g.open, [])
  equal(choices.at(-1), { here: '/club', app: undefined })
  press(doc, '/club')
  equal(doc.querySelector('[data-conversation]') === conversation, true)
  equal(text.value, 'Keep my draft')
})

test('a press from an app to another view lays the page out once: the app is gone before the scroll is put back', () => {
  let doc = page(true)
  switching(doc, () => {})
  press(doc, '/club?app=recipes')
  // Putting the scroll back lays the page out: whatever changes after it is
  // a second layout.
  let body = doc.getElementById('content')!
  let laid: boolean[] = []
  Object.defineProperty(body, 'scrollTop', {
    get: () => 0,
    set: () => laid.push(!!doc.querySelector('[data-app], .Talk-app')),
  })
  press(doc, '/club/updates')
  equal(laid, [false])
})

// An Operator page opened at a helper's conversation, the bar's title
// wearing how the helper stands; its Updates hidden.
let beside = () => {
  let { document } = parseHTML(`<html><head><title>Helper · Otto</title></head>
<body><a class="Skip" href="#ask">Skip to the message box</a>
<aside id="menu" data-side-view="{&quot;talk&quot;:{&quot;all&quot;:false}}">
<a class="SideNav_Link" href="/club/updates">Updates</a></aside>
<div class="Frame Talk Talk-zoomed">
<a class="Talk_Out" ${PART}="/club/h" href="/club">Back</a>
<b data-title><i data-mark>working</i> Helper</b>
<div id="content">
<section ${VIEW}="${
    view('/club/h', 'Helper', {
      marks: ['Talk-zoomed'],
    })
  }"><p>helper</p></section>
<section ${VIEW}="${
    view('/club/updates', 'Updates')
  }" hidden><p>news</p></section>
</div></div></body></html>`)
  let doc = document as unknown as Document
  switching(doc)
  return doc
}

test('a view shown in place takes the frame as its own: its marks, its parts, its title as it was drawn', () => {
  let doc = beside()
  let frame = () => ({
    marks: doc.querySelector('.Frame')!.className,
    parts: [...doc.querySelectorAll<HTMLElement>(`[${PART}]`)].map((e) =>
      e.hidden
    ),
    bar: doc.querySelector('[data-title]')!.innerHTML,
  })
  let was = frame()
  press(doc, '/club/updates')
  equal(frame(), {
    marks: 'Frame Talk',
    parts: [true],
    bar: 'Updates',
  })
  press(doc, '/club/h')
  equal(frame(), was)
  equal(was.parts, [false])
})

test('the conversation is watched only while it shows: while Updates shows, the tab is not on its Operator, and shown again it hears it', () => {
  let doc = page()
  let g = graph((b) => Promise.resolve(b))
  let line = operatorTalk('club', 'chat')
  let talk = pageTalk('club', 'ada', 'chat', {
    graph: g,
    in: doc.querySelector('p')!,
  })
  let heard: number[] = []
  talk.hear((told) => heard.push(told.n))
  let say = (n: number) =>
    g.set(line, [{
      entity: { eid: 'row' },
      operatorTalk: {
        space: 'club',
        task: 'chat',
        opened: 'o',
        n,
        typing: '',
      } satisfies Heard,
    }])
  equal(g.open, [line])
  say(1)
  press(doc, '/club/updates')
  equal(
    g.open,
    [],
    'Updates showing: a reply tells them in Updates and by push',
  )
  say(2)
  press(doc, '/club')
  equal(g.open, [line])
  say(3)
  equal(heard, [1, 3])
  talk.close()
  equal(g.open, [])
})

test('a conversation that is no view of its page is watched until it is closed', () => {
  let g = graph((b) => Promise.resolve(b))
  let talk = pageTalk('club', 'ada', undefined, { graph: g })
  equal(g.open, [operatorTalk('club')])
  talk.close()
  equal(g.open, [])
})

test('the prepared Operator watches its conversation only while its frame shows', () => {
  let doc = page()
  let win = doc.defaultView!
  let frames: FrameRequestCallback[] = []
  Object.defineProperty(doc, 'defaultView', {
    value: {
      Event: win.Event,
      requestAnimationFrame: (frame: FrameRequestCallback) =>
        frames.push(frame),
      setTimeout: (work: () => void) => work(),
    },
  })
  let frame = doc.createElement('div')
  frame.setAttribute('data-site-frame', '')
  frame.setAttribute('inert', '')
  frame.append(...doc.body.childNodes)
  doc.body.append(frame)
  let g = graph((b) => Promise.resolve(b))
  let talk = pageTalk('club', 'ada', 'chat', {
    graph: g,
    in: doc.querySelector('p')!,
  })
  equal(g.open, [])
  frame.removeAttribute('inert')
  frame.dispatchEvent(new win.Event(VIEWED))
  frames.shift()!(0)
  equal(g.open, [], 'the prepared conversation can paint first')
  frames.shift()!(16)
  equal(g.open, [operatorTalk('club', 'chat')])
  frame.setAttribute('inert', '')
  frame.dispatchEvent(new win.Event(VIEWED))
  equal(g.open, [])
  talk.close()
})
