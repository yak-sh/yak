// Public pages retain native content while graph navigation repaints the shell.
// A sheet draws what changed after the change, before the browser paints, so
// each look at the page waits a tick.
import { equal, ok, test, tick } from '@yaks/testing'
import { JSDOM } from 'npm:jsdom@26.1.0'
import { render } from 'preact'
import { cap, panels } from './panel.ts'
import { pageState } from './page-state.ts'
import { SHEETS } from './hud.ts'

let mounted = async (
  run: (glass: HTMLElement, dom: JSDOM) => void | Promise<void>,
) => {
  let dom = new JSDOM('<main id=glass></main>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: dom.window.document,
    configurable: true,
  })
  let glass = dom.window.document.querySelector<HTMLElement>('main')!
  try {
    await run(glass, dom)
  } finally {
    render(null, glass)
    dom.window.close()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

test('panel and tabs keep native nodes, drafts, listeners and scroll across graph edits', () =>
  mounted(async (glass) => {
    let state = pageState('panel-test')
    let manager = panels(glass, () => false, state)
    try {
      await state.ready
      let map = manager.add('map', {
        title: 'Map',
        keys: ['KeyM'],
        tall: '30rem',
      })
      let tabs = manager.book('book', {
        title: 'Book',
        tabs: {
          quests: { title: 'Quests', icon: 'done', keys: ['KeyJ'] },
          skills: { title: 'Skills', icon: 'activity', keys: ['KeyK'] },
        },
      })
      let doc = glass.ownerDocument
      let input = doc.createElement('input')
      input.value = 'precious draft'
      let button = doc.createElement('button')
      let clicks = 0
      button.addEventListener('click', () => clicks++)
      map.body.append(input, button)
      map.body.scrollTop = 37
      tabs.quests.body.append(doc.createTextNode('native quest'))
      tabs.quests.body.scrollTop = 91
      let mount = map.body.parentNode
      let sheet = glass.querySelector('.Panel-map .Panel_Sheet')
      map.show()
      equal(state.opened, 'map')
      equal(manager.open, map)
      await tick()
      equal(glass.querySelector<HTMLElement>('.Panel-map')!.hidden, false)
      map.head('<b>New map</b>')
      equal(state.heading('map'), '<b>New map</b>')
      await tick()
      equal(glass.querySelector('.Panel_Title b')?.textContent, 'New map')
      tabs.quests.show()
      equal(state.pane, 'quests')
      equal(map.open, false)
      equal(tabs.quests.open, true)
      tabs.skills.mark(true)
      equal(state.marked('book/skills'), true)
      await tick()
      let buttons = glass.querySelectorAll<HTMLButtonElement>(
        '.Panel_Tabs .Tabs_Tab',
      )
      equal(buttons[1].getAttribute('aria-label'), 'Skills')
      equal(buttons[1].querySelector('.Panel_TabLabel')?.textContent, 'Skills')
      equal(
        buttons[1].querySelector('.Glyph')?.parentElement?.getAttribute(
          'aria-hidden',
        ),
        'true',
      )
      ok(buttons[1].querySelector('.Tabs_Badge'))
      buttons[1].click()
      equal(state.pane, 'skills')
      await tick()
      equal(buttons[1].getAttribute('aria-selected'), 'true')
      equal(tabs.quests.body.hidden, true)
      tabs.quests.close()
      equal(tabs.skills.open, true)
      tabs.skills.toggle()
      equal(manager.open, null)
      await state.open('book', 'quests')
      equal(tabs.quests.body.hidden, false)
      await state.mark('book/skills', false)
      await tick()
      ok(!buttons[1].querySelector('.Tabs_Badge'))
      await state.open('map')
      await state.head('map', '<em>External heading</em>')
      await tick()
      equal(
        glass.querySelector('.Panel_Title em')?.textContent,
        'External heading',
      )
      map.head('')
      await tick()
      equal(glass.querySelector('.Panel-map .Panel_Title')!.textContent, '')
      equal(map.body.parentNode, mount)
      equal(glass.querySelector('.Panel-map .Panel_Sheet'), sheet)
      equal(map.body.firstChild, input)
      equal(input.value, 'precious draft')
      equal(map.body.scrollTop, 37)
      equal(tabs.quests.body.scrollTop, 91)
      button.click()
      equal(clicks, 1)
      equal(
        glass.querySelector('.Panel-map .Panel_Head')?.classList.contains(
          'Head',
        ),
        true,
      )
      equal(
        glass.querySelector('.Panel_Content')?.classList.contains('Body'),
        true,
      )
      equal(
        glass.querySelector<HTMLElement>('.Panel-map')!.style.getPropertyValue(
          '--tall',
        ),
        '30rem',
      )
    } finally {
      manager.dispose()
      state.dispose()
    }
  }))

test('keys, backdrop and close button preserve input, busy and pointer-lock guards', () =>
  mounted((glass, dom) => {
    let state = pageState('keys-test')
    let busy = false
    let manager = panels(glass, () => busy, state)
    let key = (code: string, options = {}) => {
      let event = new dom.window.KeyboardEvent('keydown', {
        code,
        bubbles: true,
        cancelable: true,
        ...options,
      })
      dom.window.dispatchEvent(event)
      return event.defaultPrevented
    }
    try {
      let menu = manager.add('menu', { title: 'Menu', keys: ['Escape'] })
      let map = manager.add('map', { title: 'Map', keys: ['KeyM'] })
      equal(key('KeyM'), true)
      equal(map.open, true)
      busy = true
      equal(key('Escape'), true)
      equal(manager.open, null)
      key('Escape')
      equal(menu.open, false)
      busy = false
      key('Escape')
      equal(menu.open, true)
      key('KeyM', { ctrlKey: true })
      key('KeyM', { metaKey: true })
      key('KeyM', { altKey: true })
      key('KeyM', { repeat: true })
      equal(menu.open, true)
      glass.hidden = true
      key('KeyM')
      equal(menu.open, true)
      glass.hidden = false
      let input = glass.ownerDocument.createElement('textarea')
      map.body.append(input)
      input.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          code: 'KeyM',
          bubbles: true,
        }),
      )
      equal(menu.open, true)
      Object.defineProperty(glass.ownerDocument, 'pointerLockElement', {
        configurable: true,
        value: glass,
      })
      key('Escape')
      equal(menu.open, true)
      Object.defineProperty(glass.ownerDocument, 'pointerLockElement', {
        value: null,
      })
      key('KeyM')
      let outer = 0
      glass.addEventListener('pointerdown', () => outer++)
      let sheet = glass.querySelector('.Panel-map .Panel_Sheet')!
      sheet.dispatchEvent(
        new dom.window.Event('pointerdown', { bubbles: true }),
      )
      equal(map.open, true)
      equal(outer, 0)
      glass.querySelector('.Panel-map')!.dispatchEvent(
        new dom.window.Event('pointerdown', { bubbles: true }),
      )
      equal(map.open, false)
      map.show()
      glass.querySelector<HTMLButtonElement>('.Panel-map .Panel_Close')!.click()
      equal(map.open, false)
      manager.dispose()
      key('KeyM')
      equal(manager.open, null)
      equal(glass.querySelector('.Panel'), null)
      equal(['KeyB', 'Digit1', 'ShiftLeft', 'Escape', 'Space'].map(cap), [
        'B',
        '1',
        'Shift',
        'Esc',
        'Space',
      ])
    } finally {
      manager.dispose()
      state.dispose()
    }
  }))

test('Mossvale tabs keep Menu last and world interactions open their own sheet', () =>
  mounted(async (glass, dom) => {
    let state = pageState('mossvale-panel-test')
    let manager = panels(glass, () => false, state)
    try {
      let pages = manager.book('hero', SHEETS.hero)
      let craft = manager.add('craft', SHEETS.craft)
      equal(glass.querySelectorAll('.Panel_Sheet').length, 2)
      let buttons = [...glass.querySelectorAll<HTMLButtonElement>('[role=tab]')]
      equal(buttons.at(-1)?.getAttribute('aria-label'), 'Menu')
      for (let title of ['Crafting', 'Deals', 'Notice board', 'About']) {
        equal(
          buttons.some((button) => button.getAttribute('aria-label') == title),
          false,
        )
      }
      for (let [name, page] of Object.entries(pages)) {
        let button = buttons.find((button) =>
          button.getAttribute('aria-label') ==
            SHEETS.hero.tabs[name as keyof typeof pages].title
        )!
        ok(button.querySelector('.Glyph'))
        button.click()
        equal(manager.open, page)
        await tick()
        equal(
          glass.querySelectorAll('.Panel-hero .Panel_Content:not([hidden])')
            .length,
          1,
        )
        equal(page.body.hidden, false)
      }
      pages.map.head('The valley')
      pages.map.show()
      await tick()
      equal(
        glass.querySelector('.Panel-hero .Panel_Content:not([hidden]) h2')
          ?.textContent,
        'The valley',
      )
      craft.head('Forge')
      craft.show()
      equal(pages.map.open, false)
      await tick()
      equal(
        glass.querySelector('.Panel-craft .Panel_Title')?.textContent,
        'Forge',
      )
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { code: 'KeyO' }),
      )
      equal(pages.party.open, true)
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { code: 'Escape' }),
      )
      equal(manager.open, null)
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { code: 'Escape' }),
      )
      equal(pages.menu.open, true)
      pages.map.show()
      await tick()
      equal(
        glass.querySelector('.Panel-hero .Panel_Content:not([hidden]) h2')
          ?.textContent,
        'The valley',
      )
    } finally {
      manager.dispose()
      state.dispose()
    }
  }))
