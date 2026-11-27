/**
 * A version of an app's own page (`/<space>/versions/<app>/<version>`), where
 * a line of the Dashboard's Recent work leads (./dashboard-view.ts): who put
 * it out and when, everything it changed as its release says it (the
 * `deploy{message}` app_deploy wrote, never a copy), and the ways to it: the
 * live app, and this version as it shipped where it is no longer live.
 *
 * @module
 */
import { createElement as h } from 'react'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Time } from '@yaks/ui/Time'
import { Markdown } from '@yaks/markdown'

/** What a version's page draws: its app, its number and the live one's,
 * when and by whom it went out, its release's words, and where to go: the
 * live app (`open`), this version as it shipped (`shipped`, none while it is
 * the live one) and the versions beside it (`before`, `after`). */
export type VersionView = {
  app: string
  version: number
  live: number | null
  at: string
  by: string
  message: string | null
  open: string
  shipped: string | null
  before: string | null
  after: string | null
}

/** The page's title. */
/// versionTitle({ app: 'Roster', version: 4 }) -> 'Roster, version 4'
export let versionTitle = (v: Pick<VersionView, 'app' | 'version'>) =>
  `${v.app}, version ${v.version}`

let nav = (v: VersionView) =>
  v.before || v.after
    ? h(
      'nav',
      { className: 'Version_Nav', 'aria-label': 'Other versions' },
      v.before
        ? h('a', { href: v.before, rel: 'prev' }, `← Version ${v.version - 1}`)
        : h('span', null),
      v.after
        ? h('a', { href: v.after, rel: 'next' }, `Version ${v.version + 1} →`)
        : null,
    )
    : null

/** A version's page, as `v` says it. */
export let versionView = (v: VersionView) => {
  let live = v.live == v.version
  return h(
    'div',
    { className: 'Talk_Column Version' },
    h(
      Card,
      {
        as: 'article',
        className: 'Version_Card',
        'aria-labelledby': 'version',
      },
      h('h1', { id: 'version', className: 'Version_Title' }, versionTitle(v)),
      h(
        'p',
        { className: 'Version_Meta' },
        `${v.by} · `,
        h(Time, { at: v.at }),
        live ? ' · Live now' : null,
      ),
      h(
        'div',
        { className: 'Version_Notes' },
        v.message
          ? h(Markdown, { source: v.message })
          : h('p', { className: 'Version_None' }, 'Its release left no notes.'),
      ),
      h(
        'div',
        { className: 'Version_Acts' },
        v.shipped
          ? h(
            Button,
            { mod: 'go', href: v.shipped },
            'View this version',
          )
          : null,
        h(
          Button,
          { mod: v.shipped ? undefined : 'go', href: v.open },
          live ? 'Open the app' : 'Open the live app',
        ),
      ),
    ),
    nav(v),
  )
}
