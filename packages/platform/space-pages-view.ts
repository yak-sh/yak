/**
 * A space's Settings, Domains and Trash pages (`/manage/<space>/settings`,
 * `…/domains`, `…/trash`), drawn from rows (./space-pages.ts): the space's
 * settings, its domains and its trash, and the apps it holds, as the side
 * lists them (./side-rows.ts). What the page says beside the rows
 * (`SpaceView`) is what changes only by leaving it. The server draws it for
 * the first paint, and the browser draws it again as the rows move
 * (./space-pages-browser.ts).
 *
 * @module
 */
import { h } from 'preact'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Check } from '@yaks/ui/Check'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Rows } from '@yaks/ui/Rows'
import {
  type DomainOffer,
  domainsPage,
  type Note,
  type Notes,
} from './domain-pages.ts'
import {
  addressBox,
  empty,
  fieldsOf,
  fileDrop,
  heading,
  labeled,
  MOVES,
  option,
  said,
  saving,
  send,
} from './page-parts.ts'
import { logoUpload, managePath, type MarkedApp } from './routes.ts'
import { spaceTile } from './side-parts.ts'
import { LOGO_TYPES } from './space-logo.ts'
import {
  type Binned,
  binnedOf,
  domainsOf,
  offersOf,
  settingsOf,
  type SpaceSettings,
} from './space-pages.ts'
import type { Domain } from './domain-pages.ts'
import { appsOf } from './side-rows.ts'
import type { Bundle } from '@yaks/graph'

/** Which of a space's pages. */
export type SpacePage = 'settings' | 'domains' | 'trash'

/** What the page says beside the rows: whose it is, which space (by eid)
 * and page, the platform's apex, and on Domains whether checkout is on and
 * which checkout it is back from. */
export type SpaceView = {
  person: string
  space: string
  page: SpacePage
  apex: string
  checkout?: boolean
  renewed?: string
  ordered?: string
}

/** A domain search: what was asked, and once answered, what came of it. */
export type Search = { query: string; found?: DomainOffer[]; error?: string }

/** The rows the page is drawn from, and what came of each press on it. */
export type SpaceRows = {
  settings: SpaceSettings
  apps: MarkedApp[]
  domains?: Domain[]
  binned?: Binned[]
  search?: Search
  notes?: Notes
}

/** The rows `root` is drawn from, once each is in, and what the page holds
 * beside them: the search typed, what came of each press, and the trash
 * being restored. */
export type Held = {
  settings: Bundle[]
  apps: Bundle[]
  page?: Bundle[]
  offers?: Bundle[]
  query?: string
  notes?: Notes
  restoring?: Set<string>
}

/** What the page `view` names is drawn from, of `held`; undefined until each
 * row it needs is in. */
export let heldRows = (view: SpaceView, held: Held): SpaceRows | undefined => {
  let settings = settingsOf(held.settings)
  if (!settings || (view.page != 'settings' && !held.page)) return undefined
  let page = held.page ?? []
  let search: Search | undefined = held.query
    ? { query: held.query, ...held.offers && offersOf(held.offers) }
    : undefined
  let notes = { ...held.notes }
  if (search && !search.found && !search.error) {
    notes.search ??= { words: 'Searching…' }
  } else if (search?.found && !search.error && !notes.search) {
    let count = search.found.filter((o) => o.first).length
    notes.search = {
      words: count == 1 ? '1 domain available.' : `${count} domains available.`,
    }
  }
  return {
    settings,
    apps: appsOf(held.apps, view.space),
    domains: domainsOf(page),
    binned: binnedOf(page).filter((b) => !held.restoring?.has(b.item)),
    search,
    notes,
  }
}

let named = (s: SpaceSettings) => s.title || s.slug

// Settings' Logo: the space's picture, or its letter, beside a drop zone
// that sends its own form as soon as a file is chosen, and Remove where there
// is one to take off.
let logoCard = (s: SpaceSettings, note?: Note) =>
  h(
    Card,
    null,
    heading('Logo'),
    h(
      Card.Sub,
      null,
      'Shown beside the space’s name. A square picture looks best.',
    ),
    h(
      Form,
      {
        class: 'Desk_Logo Page_Form',
        method: 'post',
        action: logoUpload(s.slug),
        enctype: 'multipart/form-data',
      },
      spaceTile(
        { slug: s.slug, title: s.title, owner: true, own: false, logo: s.logo },
        'large',
      ),
      fileDrop({
        name: 'logo',
        label: 'Logo',
        hint: 'PNG, JPEG, WebP or GIF',
        accept: LOGO_TYPES,
        required: true,
        sends: true,
      }),
      h('noscript', null, send('Upload')),
    ),
    s.logo
      ? h(
        Form,
        { class: 'Page_Form', as: 'div' },
        h(Button, { type: 'button', 'data-unlogo': '' }, 'Remove logo'),
        noteOf(note),
      )
      : null,
  )

// What came of a press, under the button pressed.
let noteOf = (note?: Note) => {
  let hint = said()
  if (!note) return hint
  return h(Form.Hint, {
    as: 'p',
    role: 'status',
    'data-said': '',
    mod: note.refused ? 'negative' : undefined,
  }, note.words)
}

// Settings' line at the foot of a paid space's pages (./woven.ts
// `bylineOf`). The hidden field says the box was on the form, so leaving it
// unticked takes the line off.
let bylineCheck = (s: SpaceSettings) =>
  h(
    Check,
    null,
    h('input', { type: 'hidden', name: 'byline', value: '' }),
    h(Check.Input, {
      type: 'checkbox',
      name: 'byline',
      value: 'on',
      checked: s.byline,
    }),
    'Show “Website by yaks.app” at the foot of your site',
    h(
      Check.Note,
      null,
      ' A small line linking to yaks.app, for visitors who would like a site like yours.',
    ),
  )

// A space's Settings: its name, its address, what it opens and its byline
// join the page's Save bar. Deleting asks again on its own page.
let settingsPage = (view: SpaceView, rows: SpaceRows) => {
  let s = rows.settings
  let host = `${s.slug}.${view.apex}`
  return [
    logoCard(s, rows.notes?.logo),
    saving(
      managePath('settings', s.slug),
      h(
        Card,
        null,
        heading('General'),
        fieldsOf(
          labeled(
            'space-title',
            'Name',
            h(Field, {
              id: 'space-title',
              placeholder: 'e.g. Oak Street Church',
              name: 'title',
              maxlength: 60,
              value: named(s),
            }),
          ),
          labeled(
            'your-address',
            'Address',
            addressBox('your-address', 'space', s.slug, view.apex),
            [
              MOVES,
              ' ',
              h(
                'a',
                { href: managePath('domains', s.slug) },
                'Manage custom domains',
              ),
              '.',
            ],
          ),
          rows.apps.length
            ? labeled(
              'your-home',
              `What ${host} opens`,
              h(
                Field,
                { choose: true, id: 'your-home', name: 'home' },
                option('', 'Your app library', !s.home),
                rows.apps.map((a) =>
                  option(a.slug, a.title || a.slug, a.slug == s.home)
                ),
              ),
            )
            : h('p', null, `${host} opens its app library.`),
          s.paying ? bylineCheck(s) : null,
        ),
      ),
    ),
    h(
      Card,
      { mod: 'danger' },
      heading('Delete this space', {
        actions: h(Button, {
          href: `https://${view.apex}/space/${
            encodeURIComponent(s.slug)
          }/delete`,
        }, 'Delete space…'),
      }),
      h(
        Card.Sub,
        null,
        'Its apps, people and data stay recoverable in the trash.',
      ),
    ),
  ]
}

// One app or number in the trash: what it is, Restore, and for a number the
// page that returns it to the phone company for good.
let binnedRow = (view: SpaceView, s: SpaceSettings, b: Binned) =>
  h(
    Rows.Item,
    { as: 'li', key: b.item },
    h(
      Rows.Main,
      null,
      h(Rows.Name, { as: 'span' }, b.name),
      h(
        Rows.Meta,
        null,
        `Kept until restored or purged${
          b.monthly ? ` · ${b.monthly} a month` : ''
        }`,
      ),
    ),
    h(
      Rows.Actions,
      null,
      h(Button, { type: 'button', 'data-restore': b.item }, 'Restore'),
      b.kind == 'number'
        ? h(Button, {
          as: 'a',
          href:
            `https://${view.apex}/space/${s.slug}/confirm/numbererase/${b.item}`,
          quiet: true,
        }, 'Return forever…')
        : null,
    ),
  )

let trashPage = (view: SpaceView, rows: SpaceRows) => {
  let binned = rows.binned ?? []
  let note = noteOf(rows.notes?.trash)
  if (!binned.length) {
    return [
      note,
      empty(
        'Trash is empty',
        h(
          'p',
          null,
          'Deleted apps and released phone numbers stay here until restored or you confirm permanent erasure.',
        ),
      ),
    ]
  }
  return h(
    Card,
    null,
    heading('Trash'),
    h(
      Card.Sub,
      null,
      'Apps and phone numbers stay recoverable until restored or you confirm permanent erasure. Numbers stop taking calls and texts, and still cost their monthly price until returned to the phone company. Restoring a number brings back its assignment.',
    ),
    note,
    h(
      Rows,
      { as: 'ul' },
      binned.map((b) => binnedRow(view, rows.settings, b)),
    ),
  )
}

/** The page `view` names, drawn from `rows`. */
export let spacePageView = (view: SpaceView, rows: SpaceRows) =>
  view.page == 'settings'
    ? settingsPage(view, rows)
    : view.page == 'trash'
    ? trashPage(view, rows)
    : domainsPage(rows.settings.slug, rows.apps, {
      domains: rows.domains ?? [],
      search: rows.search?.query,
      found: rows.search?.found,
      error: rows.search?.error,
      checkout: !!view.checkout,
      canBuy: rows.settings.included,
      renewed: view.renewed,
      ordered: view.ordered,
      notes: rows.notes,
    })
