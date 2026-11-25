import { equal, test } from '@yaks/testing'
import { CLAUDE, CODE, page, seen, viewAt } from './agents_fixture_test.ts'

test('Agents lists each agent connected with its way to open it and to disconnect it', () => {
  let at = page(viewAt(), [CLAUDE, CODE])
  equal(seen(at).listed, ['Claude', 'Claude Code'])
  equal(
    [...at.querySelectorAll('[data-disconnect]')].map((b) =>
      b.getAttribute('data-disconnect')
    ),
    ['claude', 'claude-code'],
  )
  equal(
    [...at.querySelectorAll('.Agents_Open')].map((a) => a.getAttribute('href')),
    ['https://claude.ai/new'],
  )
  equal(seen(at).connected, ['shown', 'shown'])
})

test('Agents asks for a first connection while none is, and says neither until that is known', () => {
  equal(seen(page(viewAt(), [])), {
    listed: [],
    connected: ['hidden', 'hidden'],
    disconnected: ['shown'],
  })
  equal(seen(page(viewAt())), {
    listed: [],
    connected: ['unsettled', 'unsettled'],
    disconnected: ['unsettled'],
  })
  // The steps for each app, whatever is connected.
  equal(!!page(viewAt(), []).querySelector('.Tabs_Panel-claude'), true)
})

test('New app offers each agent with a web app to ask, or the way to connect one', () => {
  let asked = page(viewAt('new'), [CLAUDE, CODE])
  equal(seen(asked), {
    listed: ['Open Claude'],
    connected: ['shown'],
    disconnected: ['hidden'],
  })
  // An agent with no web app has nothing to open, but the words to ask.
  let code = page(viewAt('new'), [CODE])
  equal(seen(code).listed, [])
  equal(seen(code).connected, ['shown'])
  equal(seen(page(viewAt('new'), [])).disconnected, ['shown'])
  equal(seen(page(viewAt('new'))).connected, ['unsettled'])
  // Asking the Operator and uploading a website, in the space it is for.
  equal(
    asked.querySelector('.Desk_Ask')?.getAttribute('action'),
    '/manage/ada/operator',
  )
  equal(
    asked.querySelector('.Deploy')?.getAttribute('action'),
    'https://ada.yaks.app/deploy',
  )
})
