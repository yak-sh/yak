/**
 * The person's Agents page (`/manage/account/agents`) and a space's New app
 * page (`/manage/<space>/new`), drawn from the agents the person connected
 * (./agents.ts): Agents lists each with its way to open it and to disconnect
 * it, and says how to connect another (./agent-guide.ts); New app offers each
 * agent with a web app as the place to ask for one, beside asking the space's
 * Operator and uploading a website. What the page says beside the row
 * (`AgentsView`) is what changes only by leaving it. The server draws it for
 * the first paint, and the browser draws it again as the row moves
 * (./agents-browser.ts).
 *
 * @module
 */
import { createElement as h, type ReactNode as Kids } from 'react'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Group } from '@yaks/ui/Group'
import { Icon } from '@yaks/ui/Icon'
import { Notice } from '@yaks/ui/Notice'
import { Rows } from '@yaks/ui/Rows'
import { State } from '@yaks/ui/State'
// @ts-types="@yaks/ui/lucide"
import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs'
import { type Agent, DESTINATIONS } from './agents.ts'
import { doors } from './agent-guide.ts'
import { type Host, spaceHost } from './host.ts'
import { dropZone, firstAsk, heading, pasteLink, state } from './page-parts.ts'
import type { Note } from './domain-pages.ts'
import { managePath } from './routes.ts'
import { connectCard } from './space-apps-view.ts'

/** What the page says beside the row: whose it is, which page, the
 * platform's apex (`env`), the link a person pastes into their agent, and on
 * New app the space it makes the app in. */
export type AgentsView = {
  person: string
  page: 'agents' | 'new'
  env: Host
  agent: string
  space?: string
}

/** What the browser holds beside the row: the agents being disconnected,
 * shown gone, and what came of the last press. */
export type Pressed = { leaving?: ReadonlySet<string>; said?: Note }

let open = (agent: Agent) => {
  let to = agent.brand && DESTINATIONS[agent.brand]
  return to
    ? h(
      'a',
      {
        className: 'Agents_Open',
        href: to.href,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      h('span', null, to.label),
      h(Icon, { of: ExternalLink }),
    )
    : null
}

// The agents connected as a card of rows, each with its way to open it and
// Disconnect, and under them what came of the last press.
let listed = (agents: Agent[], pressed: Pressed) =>
  h(
    Card,
    { hidden: !agents.length && !pressed.said },
    h(Card.Head, null, h(Card.Title, null, 'Connected agents')),
    h(
      Rows,
      {
        as: 'ul',
        className: 'Agents',
        'aria-label': 'Connected agents',
        hidden: !agents.length,
      },
      agents.map((agent) =>
        h(
          Rows.Item,
          { as: 'li', key: agent.id },
          h(
            Rows.Main,
            null,
            h(Rows.Name, null, agent.name),
            h(State, { mod: 'positive' }, 'Connected'),
          ),
          h(
            Rows.Actions,
            null,
            open(agent),
            h(Button, {
              type: 'button',
              'data-disconnect': agent.id,
              'aria-label': `Disconnect ${agent.name}`,
            }, 'Disconnect'),
          ),
        )
      ),
    ),
    h(Notice, {
      role: 'status',
      'data-said': '',
      hidden: !pressed.said,
      mod: pressed.said?.refused ? 'negative' : undefined,
    }, pressed.said?.words),
  )

/** The Agents page: the agents connected, and how to connect another.
 * `connected` is undefined until known. */
export let agentsPage = (
  view: AgentsView,
  connected: Agent[] | undefined,
  pressed: Pressed = {},
): Kids => {
  let agents = connected?.filter((a) => !pressed.leaving?.has(a.id))
  let n = agents?.length
  return [
    listed(agents ?? [], pressed),
    h(
      'p',
      state(true, n),
      'Ask for an app, or keep improving one in the same chat.',
    ),
    h(
      'p',
      state(false, n),
      'Connect once, then build and keep improving your apps in your usual chats.',
    ),
    h(
      'section',
      { className: 'Connect_Setup' },
      h(Group, state(true, n), 'Connect another agent'),
      pasteLink(view.agent),
      h('p', null, 'Or connect it yourself, with the steps for your app:'),
      doors(view.env),
    ),
  ]
}

// The New app screen's own way to ask: the person's words, sent to their
// Operator's door as a request for a new app (yaks.app's
// operator-channels.ts `new_app`), which sends them on to that conversation,
// where the app opens beside the chat as it is made. The dashboard's page is
// at the apex, as that door is.
let asking = (space: string) =>
  h(
    Card,
    null,
    heading('Ask your Operator'),
    h(
      Card.Sub,
      null,
      'Say what the app is for. Your Operator builds it in your conversation.',
    ),
    h(
      'form',
      {
        className: 'Desk_Ask Page_Form',
        method: 'post',
        action: managePath('operator', space),
        enctype: 'multipart/form-data',
      },
      h(Form.Hidden, { name: 'page', value: managePath('new', space) }),
      h(Form.Hidden, { name: 'new_app', value: '1' }),
      h(
        'p',
        null,
        h(Field, {
          className: 'Desk_Words',
          placeholder: 'Describe the app you need…',
          lines: true,
          name: 'say',
          rows: 3,
          required: true,
          'aria-label': 'What do you want to build?',
        }),
      ),
      h(Button, { mod: 'go', type: 'submit' }, 'Build it'),
    ),
  )

/** The New app page: the agents to ask, while one is connected, or the way to
 * connect one, and beside them asking the Operator and uploading a website.
 * `agents` is undefined until known. */
export let newAppPage = (view: AgentsView, agents?: Agent[]): Kids => {
  let space = view.space ?? ''
  let n = agents?.length
  let links = (agents ?? []).map(open).filter(Boolean)
  return [
    h(
      Card,
      { className: 'Desk_Start', ...state(true, n) },
      heading('Ask your agent for a new yaks app'),
      h(
        'ul',
        {
          className: 'Agents Agents-links',
          'aria-label': 'Connected agents',
          hidden: !links.length,
        },
        links.map((a) => h('li', null, a)),
      ),
      h(Form.Field, null, h(Form.Label, { as: 'p' }, 'Try this'), firstAsk()),
    ),
    connectCard(n, view.agent),
    h(
      'div',
      { className: 'Desk_Options' },
      asking(space),
      h(
        Card,
        null,
        heading('Upload your website'),
        dropZone(undefined, `https://${spaceHost(view.env, space)}/deploy`),
      ),
    ),
  ]
}

/** The page `view` names, drawn from the agents connected, undefined until
 * known. */
export let agentsView = (
  view: AgentsView,
  agents: Agent[] | undefined,
  pressed: Pressed = {},
): Kids =>
  view.page == 'new'
    ? newAppPage(view, agents)
    : agentsPage(view, agents, pressed)
