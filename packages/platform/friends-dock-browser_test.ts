import { equal, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import { client, WriteRefused } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { graph as fixture } from './page-graph_fixture_test.ts'
import { bindDock, PHONE, type Typed } from './friends-dock-browser.ts'
import { barLauncher, dock, PANEL } from './friends-dock-view.ts'
import {
  accountWords,
  type Befriended,
  FRIEND_MESSAGES,
  friendRows,
  FRIENDS,
  messageRows,
} from './account-rows.ts'

let ME = 'person-ada'
let online = {
  state: 'online' as const,
  activity: 'active' as const,
  spaces: [],
  apps: [],
}
let friend = (name: string, seen?: Befriended['seen']): Befriended => ({
  person: `person-${name}`,
  name,
  seen,
  shared: [],
})
let FRIENDS_NOW = [friend('bo', online), friend('cy')]
let at = (n: number) => new Date(Date.UTC(2026, 10, 25, 12, n)).toISOString()
let said = (eid: string, from: string, to: string, words: string, n = 0) =>
  messageRows([{
    eid,
    from,
    to,
    words,
    at: at(n),
    read: from == ME,
    operator: false,
  }])

// A page holding the dock, and the bar's launcher, as the server draws them.
let page = () => {
  let html = renderToString(
    h(
      'div',
      null,
      h('header', null, barLauncher()),
      dock({ person: ME, apex: 'yaks.app' }),
    ),
  )
  let { document, window } = parseHTML(`<html><body>${html}</body></html>`)
  return { document, window, root: document.getElementById('friends')! }
}

// What the person typed to each friend, as a draft desk keeps it.
let typed = () => {
  let kept = new Map<string, string>()
  let drafts: Typed & { kept: Map<string, string> } = {
    kept,
    bind: (field, f) => {
      field.value = kept.get(f) ?? ''
      let type = () => kept.set(f, field.value)
      field.addEventListener('input', type)
      return () => field.removeEventListener('input', type)
    },
    spend: (f) => (kept.delete(f), Promise.resolve(true)),
    restore: (f, text) => void kept.set(f, text),
  }
  return drafts
}

// The tab's graph, holding `rows` as the directory answered them.
let held = async (rows: Bundle[]) => {
  let g = client(loadVocab([accountWords]), [], {
    vault: false,
    wireVault: false,
    provenance: false,
  })
  await g.mutate([...friendRows(ME, FRIENDS_NOW), ...rows])
  return g
}

// A phone's window for `doc`, 844px tall: its history, at a page's own
// address, and its visual viewport, which `keyboard` shortens by that many
// px; `typing` moves focus into a field or out. The window is its own, as
// what is set on linkedom's is set on globalThis.
let phone = (doc: Document, Made: typeof Event) => {
  let steps: unknown[] = [null], at = 0, visible = 844
  let focused: Element | null = null
  let grew: (() => void)[] = []
  let view = Object.defineProperties(new EventTarget(), {
    height: { get: () => visible },
    offsetTop: { value: 0 },
    scale: { value: 1 },
  })
  let target = new EventTarget()
  let win = Object.assign(
    target,
    {
      visualViewport: view,
      scrollY: 0,
      scrollTo: () => {},
      location: { href: 'https://yaks.app/settings' },
      matchMedia: (q: string) => ({ matches: q == PHONE }),
      history: {
        get state() {
          return steps[at]
        },
        pushState: (state: unknown) => {
          steps.splice(++at, Infinity, state)
        },
        back: () => {
          at--
          target.dispatchEvent(new Event('popstate'))
        },
      },
      ResizeObserver: class {
        constructor(fn: () => void) {
          grew.push(fn)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    },
  )
  Object.defineProperty(doc, 'defaultView', { value: win })
  Object.defineProperty(doc, 'activeElement', {
    get: () => focused ?? doc.body,
  })
  return {
    win,
    steps: () => steps.slice(0, at + 1),
    back: () => win.history.back(),
    keyboard: (px: number) => {
      visible = 844 - px
      view.dispatchEvent(new Event('resize'))
      for (let fn of grew) fn()
    },
    typing: (to: Element | null) => {
      focused?.dispatchEvent(new Made('focusout', { bubbles: true }))
      focused = to
      to?.dispatchEvent(new Made('focusin', { bubbles: true }))
    },
  }
}

let bound = async (
  rows: Bundle[] = [],
  on?: (doc: Document, made: typeof Event) => void,
) => {
  let p = page()
  on?.(p.document, p.window.Event)
  let g = await held(rows)
  let drafts = typed()
  let timers: (() => void)[] = []
  let stop = bindDock(p.root, {
    graph: g,
    drafts: () => drafts,
    now: () => Date.parse(at(30)),
    timer: (fn) => timers.push(fn),
  })
  let panel = p.document.getElementById(PANEL)!
  let toggle = (state: 'open' | 'closed') => {
    let e = new p.window.Event('toggle')
    Object.assign(e, { newState: state })
    panel.dispatchEvent(e)
  }
  Object.assign(panel, { hidePopover: () => toggle('closed') })
  let press = (selector: string) =>
    p.root.querySelector<HTMLElement>(selector)!.dispatchEvent(
      new p.window.Event('click', { bubbles: true }),
    )
  let send = (words: string) => {
    let form = p.root.querySelector<HTMLFormElement>('[data-friend-message]')!
    form.querySelector('textarea')!.value = words
    form.dispatchEvent(
      new p.window.Event('submit', { bubbles: true, cancelable: true }),
    )
  }
  let lines = () =>
    [...p.root.querySelectorAll('.Transcript_Entry')].map((e) =>
      `${e.classList.contains('Transcript_Entry-other') ? '<' : '>'} ${
        e.querySelector('.Transcript_Bubble')?.textContent
      }`
    )
  return { ...p, g, drafts, timers, stop, toggle, press, send, lines }
}

let text = (el: Element | null) => el?.textContent?.trim() ?? ''
let flush = () => new Promise((r) => setTimeout(r, 0))

test('the launcher says who is online and how many messages wait, in the corner and the bar', async () => {
  let d = await bound(said('m1', 'person-cy', ME, 'Hi Ada'))
  let launcher = d.root.querySelector('.Dock > .Dock_Launcher')!
  equal(launcher.getAttribute('aria-label'), 'Friends: 1 unread, 1 active')
  equal(text(launcher.querySelector('.Dock_Word')), 'Friends · 1 online')
  equal(text(launcher.querySelector('.Badge')), '1')
  let bar = d.document.querySelector('[data-dock-bar]')!
  equal(text(bar.querySelector('.Badge')), '1')
  equal(bar.getAttribute('aria-label'), 'Friends: 1 unread, 1 active')
  equal(!!bar.querySelector('.Dock_Here.Dot-positive'), true)
  equal(
    [...d.root.querySelectorAll('[data-dock-friend] .Identity_Name')].map(text),
    ['bo', 'cy'],
  )
})

test('away and offline update the launchers, the list and an open conversation', async () => {
  let d = await bound()
  let indicator = (where: string) => d.document.querySelector(where)
  let bo = '[data-dock-friend="person-bo"]'
  let corner = '.Dock > .Dock_Launcher'
  let bar = '[data-dock-bar]'
  let who = '.Dock_Who'
  let avatarTone = (where: string) =>
    indicator(`${where} .Identity_Avatar`)?.getAttribute('class')
      ?.match(/\bIdentity_Avatar-tone-\d+\b/)?.[0]
  let change = async (activity: 'away' | 'offline', name = 'bo') => {
    await d.g.mutate(friendRows(ME, [{
      ...friend('bo', { ...online, activity }),
      name,
    }]))
    await flush()
  }
  try {
    await change('away')
    equal(!!indicator(`${bar} .Dock_Here.Dot-caution`), true)
    equal(!!indicator(`${corner} .Dock_Here.Dot-caution`), true)
    equal(indicator(bar)?.getAttribute('aria-label'), 'Friends: 1 away')
    equal(
      indicator(`${bo} .Friend_Dot.Dot-caution`)?.getAttribute('aria-label'),
      'Away',
    )
    equal(indicator('[data-dock-friend="person-cy"] .Friend_Dot'), null)
    let tone = avatarTone(bo)
    equal(!!tone, true)
    equal(avatarTone(corner), tone)
    d.toggle('open')
    d.press(bo)
    equal(
      indicator(`${who} .Friend_Dot.Dot-caution`)?.getAttribute('aria-label'),
      'Away',
    )
    await change('offline', 'Bea')
    equal(indicator(`${bar} .Dock_Here`), null)
    equal(indicator(bar)?.getAttribute('aria-label'), 'Friends: 0 online')
    equal(
      indicator(`${who} .Friend_Dot.Dot-offline`)?.getAttribute('aria-label'),
      'Offline',
    )
    equal(avatarTone(who), tone)
    d.press('[data-dock-back]')
    equal(
      indicator(`${bo} .Friend_Dot.Dot-offline`)?.getAttribute('aria-label'),
      'Offline',
    )
  } finally {
    d.stop()
  }
})

test('opening a friend draws the conversation in the same call, and reads theirs once the panel shows', async () => {
  let d = await bound([
    ...said('m1', 'person-cy', ME, 'Hi Ada', 1),
    ...said('m2', ME, 'person-cy', 'Hello', 2),
  ])
  d.toggle('open')
  d.press('[data-dock-friend="person-cy"]')
  equal(d.lines(), ['< Hi Ada', '> Hello'])
  equal(
    d.root.querySelector('#friends-panel')?.getAttribute('aria-label'),
    'cy and you',
  )
  await flush()
  equal(
    d.g.read(`${FRIEND_MESSAGES}&*`).find((r) => r.entity.eid == 'm1')
      ?.friendMessage,
    {
      from: 'person-cy',
      to: ME,
      words: 'Hi Ada',
      at: at(1),
      read: true,
      operator: false,
    },
  )
  equal(d.root.querySelector('.Dock > .Dock_Launcher .Badge'), null)
  d.press('[data-dock-back]')
  equal(d.lines(), [])
})

test('a message shows as sent at once, its draft spent, and a refusal puts the words back', async () => {
  let d = await bound()
  d.toggle('open')
  d.press('[data-dock-friend="person-bo"]')
  d.send('Lunch?')
  equal(d.lines(), ['> Lunch?'])
  equal(d.root.querySelector('textarea')!.value, '')
  let p = page()
  let g = fixture(() =>
    Promise.reject(
      new WriteRefused([], { error: 'arguments', message: 'Not a friend.' }),
    )
  )
  g.set(FRIENDS, friendRows(ME, FRIENDS_NOW))
  let drafts = typed()
  bindDock(p.root, { graph: g, drafts: () => drafts })
  p.root.querySelector<HTMLElement>('[data-dock-friend="person-bo"]')!
    .dispatchEvent(new p.window.Event('click', { bubbles: true }))
  let form = p.root.querySelector<HTMLFormElement>('[data-friend-message]')!
  form.querySelector('textarea')!.value = 'Hi'
  form.dispatchEvent(
    new p.window.Event('submit', { bubbles: true, cancelable: true }),
  )
  await flush()
  equal(g.wrote[0][0].friendMessage, {
    from: ME,
    to: 'person-bo',
    words: 'Hi',
    at: (g.wrote[0][0].friendMessage as { at: string }).at,
    read: true,
    operator: false,
  })
  equal(drafts.kept.get('person-bo'), 'Hi')
  equal(text(p.root.querySelector('[data-said]')), 'Not a friend.')
})

test('a message that comes while its conversation is not on screen says so quietly, then goes', async () => {
  let d = await bound()
  await d.g.mutate(said('m3', 'person-bo', ME, 'Are you there?', 29))
  let toast = d.root.querySelector('[data-dock-toast]')!
  equal(text(toast), 'bo: Are you there?')
  equal(toast.getAttribute('role'), 'status')
  d.timers.shift()!()
  equal(d.root.querySelector('[data-dock-toast]'), null)
  d.toggle('open')
  d.press('[data-dock-friend="person-bo"]')
  await d.g.mutate(said('m4', 'person-bo', ME, 'Ah, here', 30))
  equal(d.root.querySelector('[data-dock-toast]'), null)
  equal(d.lines(), ['< Are you there?', '< Ah, here'])
})

test('each friend keeps what was typed to them', async () => {
  let d = await bound()
  d.toggle('open')
  d.press('[data-dock-friend="person-bo"]')
  let field = d.root.querySelector('textarea')!
  field.value = 'for bo'
  field.dispatchEvent(new d.window.Event('input'))
  d.press('[data-dock-back]')
  d.press('[data-dock-friend="person-cy"]')
  equal(d.root.querySelector('textarea')!.value, '')
  d.press('[data-dock-back]')
  d.press('[data-dock-friend="person-bo"]')
  equal(d.root.querySelector('textarea')!.value, 'for bo')
})

test('a toast pressed in another conversation opens its own, with its own draft', async () => {
  let d = await bound()
  d.toggle('open')
  d.press('[data-dock-friend="person-bo"]')
  let field = d.root.querySelector('textarea')!
  field.value = 'for bo'
  field.dispatchEvent(new d.window.Event('input'))
  d.toggle('closed')
  await d.g.mutate(said('m5', 'person-cy', ME, 'Psst', 29))
  d.press('[data-dock-toast]')
  equal(d.lines(), ['< Psst'])
  let next = d.root.querySelector('textarea')!
  next.value = 'for cy'
  next.dispatchEvent(new d.window.Event('input'))
  equal(Object.fromEntries(d.drafts.kept), {
    'person-bo': 'for bo',
    'person-cy': 'for cy',
  })
})

test('at a phone’s width the open panel stands on a step of history at the same address, which back closes', async () => {
  let ph: ReturnType<typeof phone>
  let d = await bound([], (doc, made) => ph = phone(doc, made))
  let closed = 0
  d.document.getElementById(PANEL)!.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState == 'closed') closed++
  })
  d.toggle('open')
  equal(ph!.steps(), [null, { [PANEL]: true }])
  ph!.back()
  equal([closed, ph!.steps()], [1, [null]])
  d.toggle('open')
  d.toggle('closed')
  equal(ph!.steps(), [null])
})

test('while the panel is open a keyboard shortens it to what shows, and the newest message stays in view', async () => {
  let ph: ReturnType<typeof phone>
  let d = await bound(
    said('m1', 'person-bo', ME, 'Hi', 1),
    (doc, made) => ph = phone(doc, made),
  )
  let root = d.document.documentElement
  let height = () => root.style.getPropertyValue('--viewport-height')
  d.toggle('open')
  d.press('[data-dock-friend="person-bo"]')
  let talk = d.root.querySelector<HTMLElement>('[data-dock-said]')!
  let top = 0, tall = 600
  Object.defineProperties(talk, {
    clientHeight: { get: () => tall },
    scrollHeight: { get: () => 1000 },
    scrollTop: { get: () => top, set: (v: number) => top = v },
  })
  top = 400
  ph!.typing(d.root.querySelector('textarea'))
  tall = 300
  ph!.keyboard(300)
  equal([height(), top], ['544px', 1000])
  ph!.typing(null)
  ph!.keyboard(0)
  d.toggle('closed')
  equal(height(), '')
})
