import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import { type Agent, agentsOf, agentsRow } from './agents.ts'
import { type AgentsView, agentsView } from './agents-view.ts'

export let ADA = 'person-ada'

/** What Ada's Agents page, or her space's New app page, says beside the row. */
export let viewAt = (page: AgentsView['page'] = 'agents'): AgentsView => ({
  person: ADA,
  page,
  env: { APEX: 'yaks.app' },
  agent: 'https://yaks.app/agent',
  ...page == 'new' ? { space: 'ada' } : {},
})

/** Agents by brand, as the door lists them. */
export let CLAUDE: Agent = { id: 'claude', name: 'Claude', brand: 'claude' }
export let CODE: Agent = {
  id: 'claude-code',
  name: 'Claude Code',
  brand: 'claude-code',
}

/** Ada's agents' row, none until known. */
export let rows = (agents?: Agent[]) => agents ? [agentsRow(ADA, agents)] : []

/** The view drawn from `agents` as a server draws it. */
export let page = (view: AgentsView, agents?: Agent[]): HTMLElement => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'agents', 'data-agents-view': JSON.stringify(view) },
      agentsView(view, agentsOf(rows(agents))),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}

/** The agents `at` lists, and the parts shown only while one is connected or
 * none is: shown, hidden, or left unsettled. */
export let seen = (at: HTMLElement) => {
  let state = (attr: string) =>
    [...at.querySelectorAll(`[${attr}]`)].map((el) =>
      el.hasAttribute('data-unsettled')
        ? 'unsettled'
        : el.hasAttribute('hidden')
        ? 'hidden'
        : 'shown'
    )
  return {
    listed: [...at.querySelectorAll('.Agents:not([hidden]) li')].map((li) =>
      li.querySelector('.Rows_Name, a')?.textContent
    ),
    connected: state('data-connected'),
    disconnected: state('data-disconnected'),
  }
}
