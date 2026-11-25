import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { WriteRefused } from '@yaks/client'
import { bindAgents } from './agents-browser.ts'
import { type Agent, AGENTS } from './agents.ts'
import type { AgentsView } from './agents-view.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  CLAUDE,
  CODE,
  page,
  rows,
  seen,
  viewAt,
} from './agents_fixture_test.ts'

// The view bound to a page graph holding `agents` (Claude and Claude Code
// unless said), each write answered by `answer`, at an address whose hash
// names a tab.
let bound = (
  o: {
    on?: AgentsView['page']
    agents?: Agent[]
    answer?: (b: Bundle[]) => Promise<Bundle[]>
    hash?: string
  } = {},
) => {
  let { on = 'agents', answer = ok, hash = '' } = o
  // None until known, when the test says so.
  let agents = 'agents' in o ? o.agents : [CLAUDE, CODE]
  let root = page(viewAt(on), agents)
  let g = graph(answer)
  g.set(AGENTS, rows(agents))
  let location = new URL(`https://yaks.app/manage/account/agents${hash}`)
  let heard: Record<string, () => void> = {}
  let win = {
    location,
    history: {
      state: null,
      replaceState: (_s: unknown, _t: string, to: string) =>
        location.href = new URL(to, location).href,
    },
    addEventListener: (type: string, fn: () => void) => heard[type] = fn,
  }
  bindAgents(root, g, win as never)
  let fire = (el: Element, type: string) =>
    el.dispatchEvent(
      new (root.ownerDocument.defaultView!).Event(type, { bubbles: true }),
    )
  return { root, g, location, heard, fire }
}
let ok = (b: Bundle[]) => Promise.resolve(b)
let tick = () => new Promise((go) => setTimeout(go))

test('an agent connected or disconnected elsewhere redraws the list without a reload', () => {
  let { root, g } = bound({ agents: [] })
  equal(seen(root).listed, [])
  g.set(AGENTS, rows([CODE]))
  equal(seen(root).listed, ['Claude Code'])
  equal(seen(root).disconnected, ['hidden'])
  g.set(AGENTS, rows([]))
  equal(seen(root).listed, [])
  equal(seen(root).disconnected, ['shown'])
})

test('New app settles once the agents are in', () => {
  let { root, g } = bound({ on: 'new', agents: undefined })
  equal(seen(root).connected, ['unsettled'])
  g.set(AGENTS, rows([CLAUDE]))
  equal(seen(root), {
    listed: ['Open Claude'],
    connected: ['shown'],
    disconnected: ['hidden'],
  })
})

test('Disconnect writes through the graph, the agent gone at once and what came of it said', async () => {
  let release = () => {}
  let { root, g } = bound({
    answer: (b) =>
      new Promise((go) =>
        release = () =>
          go([{ ...b[0], disconnectAgent: { agent: 'claude', said: 'Done.' } }])
      ),
  })
  let press = root.querySelector<HTMLElement>('[data-disconnect=claude]')!
  press.click()
  equal(seen(root).listed, ['Claude Code'])
  equal(g.wrote.map((b) => b.map(({ entity: _, ...c }) => c)), [
    [{ disconnectAgent: { agent: 'claude' } }],
  ])
  g.set(AGENTS, rows([CODE]))
  release()
  await tick()
  equal(seen(root).listed, ['Claude Code'])
  equal(root.querySelector('[data-said]')?.textContent, 'Done.')
})

test('a refused Disconnect brings the agent back and says why where it was pressed', async () => {
  let { root } = bound({
    answer: (b) =>
      Promise.reject(
        new WriteRefused(
          b,
          { error: 'arguments', message: 'Not now.' } as never,
        ),
      ),
  })
  root.querySelector<HTMLElement>('[data-disconnect=claude]')!.click()
  await tick()
  equal(seen(root).listed, ['Claude', 'Claude Code'])
  let said = root.querySelector('[data-said]')!
  equal([said.textContent, said.hasAttribute('hidden')], ['Not now.', false])
})

test('the address names the open tab, and picking one names it', () => {
  let { root, location, heard, fire } = bound({ hash: '#cursor' })
  let tab = (key: string) =>
    root.querySelector<HTMLInputElement>(`#tab-${key}`)!
  equal(tab('cursor').checked, true)
  tab('grok').checked = true
  fire(tab('grok'), 'change')
  equal(location.hash, '#grok')
  location.hash = '#claude'
  heard.hashchange()
  equal(tab('claude').checked, true)
})

test('a website dropped on New app names itself from its file, never over a name typed', () => {
  let { root, fire } = bound({ on: 'new' })
  let file = root.querySelector<HTMLInputElement>('.Deploy input[type=file]')!
  let slug = root.querySelector<HTMLInputElement>('.Deploy input[name=slug]')!
  let choose = (name: string) => {
    Object.defineProperty(file, 'files', {
      value: [{ name }],
      configurable: true,
    })
    fire(file, 'change')
  }
  choose('Family Recipes.zip')
  equal(slug.value, 'family-recipes')
  choose('other.zip')
  equal(slug.value, 'family-recipes')
})

test('the copy buttons show once the script that works them is here', () => {
  let { root } = bound({ on: 'new' })
  equal(
    [...root.querySelectorAll<HTMLElement>('.Copy_Go')].every((go) =>
      !go.hidden
    ),
    true,
  )
})
