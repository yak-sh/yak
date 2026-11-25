import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { DRAW, type Drawing } from '@yaks/ui/navigate'
import { switching } from './talk-views-browser.ts'
import { type TalkView, VIEW } from './talk-views.ts'

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
      ...more,
    } satisfies TalkView,
  ).replaceAll('"', '&quot;')

// An Operator page opened at its conversation, its Updates standing hidden.
let page = () => {
  let { document } = parseHTML(`<html><head><title>Chat · Otto</title></head>
<body><a class="Skip" href="#ask">Skip to the message box</a>
<aside id="menu" data-side-view="{&quot;talk&quot;:{&quot;all&quot;:false}}">
<form data-side><input name="back" value="/club"></form>
<a class="SideNav_Link SideNav_Link-on" aria-current="page" href="/club">Otto</a>
<a class="SideNav_Link" href="/club/updates">Updates</a></aside>
<b data-title>Chat</b><div class="Frame_AsideTools"></div>
<div id="content">
<section ${VIEW}="${
    view('/club', 'Chat', {
      skip: ['#ask', 'Skip to the message box'],
      aside: true,
    })
  }"><p>chat</p></section>
<section ${VIEW}="${
    view('/club/updates', 'Updates')
  }" hidden><p>news</p></section>
</div><aside id="aside"></aside></body></html>`)
  let doc = document as unknown as Document
  switching(doc)
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

test('an address the page holds no view of is left to the navigator', () => {
  let doc = page()
  equal(press(doc, '/club?app=packing'), false)
  equal(press(doc, '/updates?in=club'), false)
  equal(shown(doc).view, ['chat'])
})
