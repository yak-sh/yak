// The public about sheet offers hosting, source and the carried guide.
import { equal, ok, test } from '@yaks/testing'
import { JSDOM } from 'npm:jsdom@26.1.0'
import { about } from './about.ts'
import { panels } from './panel.ts'
import { pageState } from './page-state.ts'

test('about draws base parts and working actions inside a retained page body', () => {
  let dom = new JSDOM('<main></main>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  })
  let glass = dom.window.document.querySelector<HTMLElement>('main')!
  let state = pageState('about-test')
  let manager = panels(glass, () => false, state)
  try {
    let panel = manager.add('yaks', { title: 'yaks.app' })
    about(panel)
    let body = panel.body
    let content = body.querySelector('.Yaks')!
    ok(content.classList.contains('Body'))
    ok(content.textContent!.includes('Mossvale was built on yaks.app.'))
    let actions = [
      ...body.querySelectorAll<HTMLAnchorElement>('.Yaks_Actions a'),
    ]
    equal(actions.map((a) => a.getAttribute('href')), [
      'https://yaks.app/login',
      'https://github.com/yak-sh/yak/tree/main/apps/vale',
      './guide.html',
    ])
    for (let action of actions) {
      ok(action.classList.contains('Button'))
      ok(action.classList.contains('Btn'))
    }
    for (let action of actions.slice(0, 2)) {
      equal(action.target, '_blank')
      equal(action.rel, 'noopener noreferrer')
    }
    panel.show()
    panel.head('Build a world')
    panel.close()
    panel.show()
    equal(panel.body, body)
    equal(body.querySelector('.Yaks'), content)
    about(panel)
    equal(body.querySelector('.Yaks'), content)
    equal(body.querySelectorAll('.Yaks').length, 1)
  } finally {
    manager.dispose()
    state.dispose()
    dom.window.close()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
