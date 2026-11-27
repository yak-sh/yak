/**
 * A space's Apps page (`/manage/<space>/apps`), drawn from rows
 * (./space-apps.ts): the space's apps, one row each, every row opening its
 * app and the errors it has opening over the page; above them, the way to
 * connect an agent while none is; with no app, the way to make one. The server
 * draws it for the first paint, and the browser draws it again as the rows
 * move and as a person searches or orders a long list
 * (./space-apps-browser.ts).
 *
 * @module
 */
import { type ComponentChildren as Kids, Fragment, h } from 'preact'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Icon } from '@yaks/ui/Icon'
import { Modal } from '@yaks/ui/Modal'
import { Rows } from '@yaks/ui/Rows'
import { Time } from '@yaks/ui/Time'
// @ts-types="@yaks/ui/lucide"
import X from 'lucide/dist/esm/icons/x.mjs'
import { appTile, fixId } from './app-tile.ts'
import {
  copyable,
  empty,
  firstAsk,
  heading,
  option,
  pasteLink,
  state,
  status,
} from './page-parts.ts'
import { chatPath, managePath } from './routes.ts'
import {
  type Broken,
  type Listed,
  type Plain,
  writersOf,
} from './space-apps.ts'

/** What the Apps page says beside the rows: whose and which space's it is,
 * the space's host, the link an agent connects from, and what the list was
 * asked to find and how to order it. */
export type AppsView = {
  person: string
  space: { eid: string; slug: string }
  host: string
  agent: string
  sift: { q: string; sort: string }
}

/** The rows the page is drawn from: the apps, each with its open breaks, and
 * how many agents the person connected, undefined until it is known. */
export type AppsRows = { apps: Broken[]; agents?: number }

// When an app last changed: its last deploy, or else when it was made.
let changed = (a: Listed) => (a.deployed ?? a.made)?.at ?? ''
let named = (a: Listed) => a.title || a.slug

// The orders the page offers, the first the one it opens in.
let ORDERS = [
  ['changed', 'Recent'],
  ['name', 'Name'],
] as const

/** The apps whose name or address holds every word of `q`, newest change
 * first, or with `sort` 'name', by name. */
/// sifted([], 'x', 'name') -> []
export let sifted = <T extends Listed>(apps: T[], q = '', sort = ''): T[] => {
  let words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return apps
    .filter((a) =>
      words.every((w) => `${a.title} ${a.slug}`.toLowerCase().includes(w))
    )
    .toSorted(
      sort == 'name'
        ? (a, b) => named(a).localeCompare(named(b))
        : (a, b) => changed(b).localeCompare(changed(a)),
    )
}

// More apps than this and the list can be searched and ordered.
let LONG = 8

// The search and the order above a long list, in its card's head: sent, the
// page answers sifted; with script, the list narrows as a person types.
let finding = (sift: AppsView['sift']) =>
  h(
    Card.Form,
    { method: 'get', role: 'search', 'data-find-apps': '' },
    h(Field, {
      type: 'search',
      name: 'q',
      value: sift.q,
      placeholder: 'Find an app',
      'aria-label': 'Find an app',
      // Narrow enough to share a phone's line with the order beside it.
      size: 14,
    }),
    h(
      Field,
      { choose: true, name: 'sort', 'aria-label': 'Order' },
      ORDERS.map(([value, label]) =>
        option(value, label, (sift.sort || 'changed') == value)
      ),
    ),
  )

/** Where a person who has not connected an agent is asked to, hidden once
 * one is (`agents`, their count, undefined until known). */
export let connectCard = (agents: number | undefined, link: string) =>
  h(
    Card,
    { mod: 'accent', ...state(false, agents) },
    heading('Connect your agent', {
      actions: h(
        Button,
        { mod: 'go', href: managePath('agents') },
        'Connect agent',
      ),
    }),
    h(
      Card.Sub,
      null,
      'Build and improve your apps in the conversations you already have with Claude or ChatGPT.',
    ),
    pasteLink(link),
  )

let SHOWN = 5

/** What the space's Operator made of one break, with the way to its
 * conversation in the Operator's chat app. */
export let operated = (e: Plain, space: string) => {
  let o = e.operator
  if (!o) return null
  let said = o.failed != null
    ? `The Operator could not fix it. ${o.failed}`.trim()
    : o.answer != null
    ? `The Operator: ${o.answer}`
    : 'The Operator is fixing it.'
  return h(
    Rows.Meta,
    null,
    `${said} `,
    h('a', { href: chatPath(space, e.fix) }, 'See what it did'),
  )
}

/** What broke in an app, for its owner: each break as its line says it to
 * their assistant, how often and when last, and the one thing to do, which
 * is to ask that assistant. It is a dialog over the page, opened by the error
 * badge on the app's row (./app-tile.ts) with no script: a popover, which the
 * backdrop, the close button and Escape put away. */
export let fixing = (a: Broken, space: string) => {
  let errors = a.errors ?? []
  let n = errors.length
  let title = named(a)
  let id = fixId(a.slug)
  let shut = { popovertarget: id, popovertargetaction: 'hide', type: 'button' }
  return h(
    Modal,
    {
      as: 'div',
      popover: '',
      id,
      role: 'dialog',
      'aria-label': `What broke in ${title}`,
    },
    h(Modal.Backdrop, {
      as: 'button',
      ...shut,
      tabIndex: -1,
      'aria-label': 'Close',
    }),
    h(
      Modal.Body,
      { class: 'Fix' },
      heading(title, {
        status: status(n == 1 ? '1 error' : `${n} errors`, 'negative'),
        actions: h(
          Modal.Close,
          {
            ...shut,
            mod: 'quiet',
            'aria-label': 'Close',
            'data-tip': 'Close',
            autofocus: true,
          },
          h(Icon, { of: X }),
        ),
      }),
      h(
        Rows,
        { as: 'ul' },
        errors.slice(0, SHOWN).map((e) =>
          h(
            Rows.Item,
            { as: 'li' },
            h(
              Rows.Main,
              null,
              h('span', { class: 'Fix_Said' }, e.said || 'No message'),
              h(
                Rows.Meta,
                null,
                `${e.where ? `${e.where} · ` : ''}${
                  e.times == 1 ? 'once' : `${e.times} times`
                }`,
                e.at
                  ? [`, ${e.times == 1 ? '' : 'last '}`, h(Time, { at: e.at })]
                  : null,
              ),
              operated(e, space),
            ),
          )
        ),
      ),
      n > SHOWN ? h(Rows.Meta, { as: 'p' }, `And ${n - SHOWN} more.`) : null,
      h(
        Form.Field,
        null,
        h(
          Form.Label,
          { as: 'p' },
          `Ask your assistant to fix ${n == 1 ? 'it' : 'them'}`,
        ),
        copyable(
          `Fix the errors in my ${title} app on yaks.app`,
          `the request to fix ${title}`,
        ),
      ),
    ),
  )
}

// The apps, one row each, the search and order above a long list. Each says
// its address from its path: the host is the space's, the same on every row.
let listed = (view: AppsView, apps: Broken[]) => {
  let { slug } = view.space
  let n = apps.length
  let long = n > LONG
  let shown = sifted(apps, view.sift.q, view.sift.sort)
  let writers = writersOf(apps)
  return [
    h(
      Card,
      null,
      heading(n == 1 ? '1 app' : `${n} apps`, {
        actions: long ? finding(view.sift) : null,
      }),
      h(
        Rows,
        { as: 'ul', id: 'apps' },
        shown.map((a) =>
          appTile(a, {
            at: `https://${view.host}`,
            errors: a.errors?.length,
            editor: true,
            visits: `${managePath('visits', slug)}#visits-${a.slug}`,
            made: a.made,
            deployed: a.deployed,
            writers,
            me: view.person,
            gallery: a.gallery,
          })
        ),
      ),
      long && !shown.length
        ? h(Rows.Note, null, 'No app here has that in its name or address.')
        : null,
    ),
    apps.filter((a) => a.errors?.length).map((a) => fixing(a, slug)),
  ]
}

// No app yet: what the page will hold, and how to make the first.
let none = (view: AppsView, agents?: number) =>
  empty(
    'Your apps will live here',
    h(
      'div',
      state(true, agents),
      h('p', null, 'Ask your agent for your first app. Try this:'),
      firstAsk(),
    ),
    h(
      'div',
      state(false, agents),
      h(
        'p',
        null,
        'A recipe box, a book club page, a tool for your day. Start with an idea.',
      ),
      h(
        'a',
        { href: managePath('new', view.space.slug) },
        'More ways to make an app',
      ),
    ),
  )

/** The Apps page: `view`, drawn from `rows`. */
export let appsView = (view: AppsView, rows: AppsRows): Kids =>
  h(
    Fragment,
    null,
    connectCard(rows.agents, view.agent),
    rows.apps.length ? listed(view, rows.apps) : none(view, rows.agents),
  )
