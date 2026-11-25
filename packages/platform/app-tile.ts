// The app library's Tile: one row of the kit's Rows, pressed anywhere to open
// the app in a new tab. Its mark is the app's own icon, or its first letter
// where it drew none (apps.ts `unwritten`); under its name, a quiet line
// says where it lives and when it last changed, and who changed it where that
// was not the person looking, such as an agent writing for them. At the far side sit its open
// errors, as a badge that opens them, a glyph for whether it is the space's
// homepage and one for who may use it, each named in a tooltip, and the menu
// of what else can be done with it.
//
// Page context: `at`, the space's own address, on a page that is not there;
// `host`, the space's own host, said before the app's path; `errors`, the
// count of open ones its owner's dashboard shows, opened in the dialog
// `fix-<slug>` beside the list (workers/yak desk-pages.ts `library`); `icon`, the picture
// to wear instead of the app's own, for a viewer the app's own would be
// refused to (a private app, before they are in); `editor`, a menu for
// someone who may open its data editor; `visits`, where its visits are
// counted; `made` and `deployed`, when it was made and last deployed, and by
// whom; `writers`, what each writer is called (workers/yak stamps.ts), and `me`, the
// person looking; and `gallery`, how it stands with the gallery, said only to
// its owner.

import { parse } from '@yaks/query'
import { type ComponentRenderer, render } from '@yaks/preact'
import { define } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import { once } from '@yaks/fp'
import { Badge } from '@yaks/ui/Badge'
import { Icon } from '@yaks/ui/Icon'
import { Menu } from '@yaks/ui/Menu'
import { Rows } from '@yaks/ui/Rows'
import { WARM } from '@yaks/ui/navigate'
import { Time } from '@yaks/ui/Time'
import { h } from 'preact'
import type { IconNode } from 'lucide'
// @ts-types="@yaks/ui/lucide"
import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
// @ts-types="@yaks/ui/lucide"
import Globe from 'lucide/dist/esm/icons/globe.mjs'
// @ts-types="@yaks/ui/lucide"
import House from 'lucide/dist/esm/icons/house.mjs'
// @ts-types="@yaks/ui/lucide"
import Lock from 'lucide/dist/esm/icons/lock.mjs'
// @ts-types="@yaks/ui/lucide"
import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
import { appMarkImage, appWarmAt, type MarkedApp } from './routes.ts'

/** When something was written, and by whom. */
export type Stamp = { at: string; by: string | null }

/** What each writer is called, by eid. */
export type Writers = ReadonlyMap<string, string>

// Who may use an app, as a glyph and the words its tooltip says.
let ACCESS = {
  public: [
    Globe,
    'Public: anyone can open it, and its members change its data',
  ],
  open: [
    Pencil,
    'Open: anyone with the link can open it and change its data',
  ],
  private: [Lock, 'Private: only people let in can open it'],
} as const

// A glyph that stands for a word: said to a screen reader and in a tooltip.
let glyph = (of: IconNode, words: string) =>
  h(
    Rows.Meta,
    { role: 'img', 'aria-label': words, 'data-tip': words },
    h(Icon, { of }),
  )

/** The id of the dialog showing what broke in the app at `slug`. */
export let fixId = (slug: string) => `fix-${slug}`

export let app: ComponentRenderer = {
  view: 'Tile',
  match: parse('.app'),
  Render: ({ e: b, ...ctx }) => {
    let a = b.app as {
      slug: string
      access?: string | null
      source?: string | null
      generatedIcon?: string
    }
    let title = (b.doc as { title?: string } | undefined)?.title || a.slug
    let at = `${ctx.at ?? ''}/${a.slug}`
    // The space's host, which its homepage opens at.
    let space = ctx.host || (ctx.at ? new URL(String(ctx.at)).host : '')
    let errors = Number(ctx.errors ?? 0)
    let broke = errors ? `${errors} ${errors == 1 ? 'error' : 'errors'}` : ''
    let changed = (ctx.deployed ?? ctx.made) as Stamp | null | undefined
    let names = (ctx.writers ?? new Map()) as Writers
    let by = changed?.by && changed.by != ctx.me
      ? names.get(changed.by)
      : undefined
    let access = ACCESS[a.access as keyof typeof ACCESS]
    let fix = { popovertarget: fixId(a.slug), type: 'button' }
    // What public/sift.js finds and orders the row by.
    let sift = {
      'data-words': `${title} ${a.slug}`.toLowerCase(),
      'data-name': title,
      'data-changed': changed?.at ?? '',
    }
    let mark = appMarkImage(at, { ...a, eid: b.entity.eid, title })
    let size = { width: 32, height: 32 }
    return h(
      Rows.Item,
      { as: 'li', ...sift },
      ctx.icon
        ? h(Rows.Mark, { src: ctx.icon, alt: '', loading: 'lazy', ...size })
        : h(
          Rows.Mark,
          { as: 'span', ...mark.backdrop },
          h('img', { ...mark.image, ...size }),
        ),
      h(
        Rows.Main,
        null,
        h(
          Rows.Name,
          { mod: 'line' },
          h(
            Rows.Open,
            {
              href: `${at}/`,
              [WARM]: appWarmAt(at),
              target: '_blank',
              rel: 'noopener',
            },
            title,
          ),
        ),
        // Where it lives and when it changed wraps on a phone, never cut.
        h(
          Rows.Meta,
          null,
          `${ctx.host ?? ''}/${a.slug}`,
          changed
            ? [
              ' · changed ',
              h(Time, { at: changed.at }),
              by ? ` by ${by}` : null,
            ]
            : null,
          ctx.gallery ? ` · ${ctx.gallery}` : null,
        ),
      ),
      h(
        Rows.Actions,
        null,
        broke
          ? h(
            Badge,
            { as: 'button', ...fix, 'data-tip': 'See what broke' },
            broke,
          )
          : null,
        b.home
          ? glyph(
            House,
            `The homepage: it opens at ${space || 'the space’s address'}`,
          )
          : null,
        access ? glyph(access[0], access[1]) : null,
        ctx.editor
          ? h(
            Menu.Fold,
            { 'data-menu': '' },
            h(
              Menu.Summary,
              {
                mod: 'icon',
                'aria-label': `More for ${title}`,
                'data-tip': 'More',
              },
              h(Icon, { of: Ellipsis }),
            ),
            h(
              Menu,
              { mod: ['below', 'end'] },
              h(Menu.Item, {
                as: 'a',
                href: `${at}/_web/data`,
                target: '_blank',
                rel: 'noopener',
              }, 'Edit data'),
              ctx.visits
                ? h(Menu.Item, { as: 'a', href: String(ctx.visits) }, 'Visits')
                : null,
              broke ? h(Menu.Item, fix, `See ${broke}`) : null,
            ),
          )
          : null,
      ),
    )
  },
}

// The tile, matched against the words it draws alone.
let tiles = define([app])
let words = once(() =>
  loadVocab([{
    $defs: {
      app: {
        component: true,
        type: 'object',
        properties: {
          slug: { type: 'string' },
          access: { type: ['string', 'null'] },
          source: { type: ['string', 'null'] },
          generatedIcon: { type: 'string' },
        },
      },
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
      home: { component: true, type: 'object' },
    },
  }])
)

/** An app as a row of a list, with what the page around it says
 * (`around`, the page context above). */
export let appTile = (
  a: MarkedApp & { home?: boolean; access?: string | null },
  around: Record<string, unknown> = {},
) =>
  render(
    tiles,
    {
      entity: { eid: a.eid },
      app: {
        slug: a.slug,
        access: a.access,
        source: a.source,
        generatedIcon: a.generatedIcon,
      },
      doc: { title: a.title },
      ...a.home ? { home: {} } : {},
    },
    'List.Tile',
    words(),
    around,
  )
