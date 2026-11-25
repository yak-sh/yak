/**
 * The app open beside the chat (T-140509), and the one the Operator is making
 * in it (D-146737), drawn from rows (./app-canvas.ts): its icon, its name and
 * where it lives, a way to open it in a tab of its own, and under them what
 * it is made of: Data, Commands, Workflow when it has one, and Preview, with
 * the newest stage of making it open. Its preview is the app itself, live,
 * and its draft while that holds changes not released, which follows each
 * write and is named for when it was last written. The app's
 * host lets the platform frame it (./kept.ts `sealed`). On a phone it takes
 * the screen in the chat's place while chosen (`#app`), and Chat goes back.
 *
 * Its head and live preview are drawn from the side's row of the app at once;
 * what it is made of fills in once its `appMaking` row is in, the stage busy
 * until then. The server draws it for the first paint, and
 * ./app-canvas-browser.ts draws it again as its rows move.
 *
 * @module
 */
import { type ComponentChildren as Node, h } from 'preact'
import {
  Button,
  Card,
  Check,
  Chip,
  Empty,
  Icon,
  Identity,
  layer,
  Preview,
  Rows,
  TabSet,
  Toolbar,
} from '@yaks/ui/parts'
// @ts-types="@yaks/ui/lucide"
import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
// @ts-types="@yaks/ui/lucide"
import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs'
import { Time } from '@yaks/ui/Time'
import { does, keeps, runs } from './app-made.ts'
import { draftPreview, type Making, type ShownDraft } from './app-canvas.ts'
import { appMark, type MarkedApp } from './routes.ts'

/** What the canvas is drawn for, beside its rows: where the space's apps
 * answer (`https://<space host>`), what its Operator is called, and the app,
 * as the side's row says it. */
export type CanvasView = {
  at: string
  operator: string
  app: MarkedApp
}

/** What the canvas carries to be drawn again in the browser
 * (./app-canvas-browser.ts): its view, and the person and the space's eid its
 * rows are watched for. */
export type CanvasRoot = CanvasView & { person: string; space: string }

/** The conversation's address when no app is open, and its canvas scope. */
export type CanvasSlot = Omit<CanvasRoot, 'app'> & { here: string }

/** The place beside the conversation where its canvas opens. */
export let SLOT = 'data-canvas-slot'

/** The app canvas view. */
export let VIEW = '[data-view="app-canvas"]'

/** The app selected beside the conversation changed. */
export let CANVAS_CHANGED = 'yak-canvas-changed'

/** The conversation's page and selected app, as its message box sends them. */
export type CanvasChoice = { here: string; app?: MarkedApp }

/** The prompt in a conversation about an app. */
export let appQuestion = (app: { slug: string; title?: string }) =>
  `What should change in ${app.title || app.slug}?`

/** The attributes that make a canvas drawn for `root` a view the browser
 * draws again. */
export let canvasAttrs = (root: CanvasRoot): Record<string, string> => ({
  'data-view': 'app-canvas',
  'data-canvas-view': JSON.stringify(root),
})

let NOTHING: Making = {
  made: { kinds: [], acts: [], finds: [] },
  pages: [],
  steps: [],
  draft: null,
  edited: null,
}

/** Where the app's own address is, once released. */
export let liveAt = ({ at, app }: Pick<CanvasView, 'at' | 'app'>) =>
  app.source ? `${at}/${app.slug}/` : null

// Which of the canvas's tabs opens: the newest stage of making it reached,
// the preview once there is one.
let stageOf = (live: string | null, { made, draft }: Making) =>
  live || draft
    ? 'preview'
    : !made.kinds.length && made.acts.length
    ? 'does'
    : 'keeps'

// Its preview: the draft while it differs from what is live, named for when
// it was last written, and the app itself once released, each in a frame
// that keeps where its page has gone (`data-at`, public/frames.js) and fills
// the panel. While both are there a pair of radios switches them (pages.css
// shows the frame of the checked one, and the other loads once shown), the
// draft first, since it is what is changing.
let editedLabel = (at: string) => ['Edited ', h(Time, { at, tabindex: -1 })]

let draftList = (app: string, drafts: ShownDraft[]): Node => [
  h('p', { role: 'status', 'data-draft-status': '', hidden: true }),
  !drafts.length ? h(Empty, null, h('p', null, 'No open drafts.')) : h(
    Rows,
    { as: 'ul', mod: 'ruled', 'aria-label': 'Open drafts' },
    drafts.map((d) =>
      h(
        Rows.Item,
        { as: 'li', 'data-key': d.eid },
        h(
          Rows.Main,
          null,
          h(Rows.Name, null, d.writers.join(', ') || 'Unattributed draft'),
          h(
            Rows.Meta,
            null,
            d.edited ? editedLabel(d.edited) : 'Edit time unknown',
          ),
          d.behind
            ? h('span', null, h(Chip, { mod: 'quiet' }, 'Behind live'))
            : null,
          h(Rows.Meta, null, d.paths.join(', ') || 'No files changed'),
          d.crossed.length
            ? h(
              Rows.Meta,
              null,
              'Also changed in a release · ',
              d.crossed.join(', '),
            )
            : null,
        ),
        h(
          Rows.Actions,
          null,
          h(Button, {
            href: draftPreview(app, d.eid),
            target: '_blank',
            rel: 'noopener',
          }, 'Preview'),
          h(Button, { type: 'button', 'data-draft-act': 'release' }, 'Release'),
          h(Button, {
            type: 'button',
            mod: 'danger',
            'data-draft-act': 'discard',
          }, 'Discard'),
        ),
      )
    ),
  ),
]

let preview = (
  title: string,
  operator: string,
  live: string | null,
  draft: string | null,
  edited: string | null,
) => {
  if (!live && !draft) {
    return h(
      Empty,
      null,
      h('p', null, `${title} shows here as ${operator} makes it.`),
    )
  }
  let choices = [
    draft && {
      id: 'draft' as const,
      at: draft,
      said: edited ? editedLabel(edited) : 'Draft',
    },
    live && { id: 'live' as const, at: live, said: 'Live' },
  ].filter((x) => !!x)
  return h(
    Preview.Choices,
    { role: 'radiogroup', 'aria-label': 'Which preview' },
    choices.map((choice, i) =>
      h(
        Preview.Item,
        // Keyed, so a draft arriving beside the live app leaves it loaded
        // where it is (@yaks/ui/navigate `morph`).
        { 'data-key': choice.id },
        choices.length > 1
          ? h(
            Preview.Choice,
            {},
            h(Check.Input, {
              type: 'radio',
              name: 'preview',
              value: choice.id,
              checked: i == 0,
            }),
            choice.said,
          )
          : null,
        h(
          Preview.View,
          {},
          h(Preview.Frame, {
            mod: 'flat',
            src: choice.at,
            title: `${title}, ${choice.id == 'draft' ? 'the draft' : 'live'}`,
            name: `preview-${choice.id}`,
            'data-frame': choice.id,
            'data-at': choice.at,
            ...choice.id == 'live' && draft ? { loading: 'lazy' } : {},
          }),
        ),
      )
    ),
  )
}

// On a phone the app takes the screen as a layer, in from the right, the
// way the bar's button to it points.
let Slides = layer('section', 'right')

/** The app beside the chat, drawn from the side's row of it and, once in,
 * what it is made of, wearing `attrs` (`canvasAttrs`). Each part the browser
 * puts in place again as the Operator works is named by `data-part`. */
export let appCanvas = (
  view: CanvasView,
  making?: Making,
  attrs: Record<string, string> = {},
  opening = false,
): Node => {
  let { app, operator } = view
  let title = app.title || app.slug
  let host = `${new URL(view.at).host}/${app.slug}`
  let whose = { app: title, operator }
  let live = liveAt(view)
  let now = making ?? NOTHING
  let stage = stageOf(live, now)
  // Open starts at the frame on screen; location reports keep it current.
  let away = now.draft ?? live
  let tab = (id: string, name: Node, ...inside: Node[]) =>
    h(
      TabSet.Item,
      null,
      h(TabSet.Input, {
        type: 'radio',
        name: 'made',
        id: `made-${id}`,
        value: id,
        checked: id == stage,
      }),
      h(TabSet.Tab, { for: `made-${id}` }, name),
      h(
        TabSet.Panel,
        {
          as: Card,
          class: `Talk_Part Talk_Part-${id}`,
          'data-part': id,
          'data-compact': id == 'preview' ? '' : undefined,
        },
        h('div', { class: 'Talk_Sheet' }, ...inside),
      ),
    )
  return h(
    Preview,
    {
      as: Slides,
      mod: 'pane',
      class: 'Talk_App',
      id: 'app',
      'aria-label': title,
      'data-app': app.slug,
      'data-stage': stage,
      ...attrs,
    },
    h(
      Toolbar,
      { mod: 'compact', 'data-part': 'head' },
      h(
        Button,
        { href: '#', class: 'Talk_Back', 'data-pane': '' },
        h(Icon, { of: ArrowLeft }),
        'Chat',
      ),
      h(Identity.Image, {
        src: appMark(`${view.at}/${app.slug}`, app),
        width: 24,
        height: 24,
        alt: '',
      }),
      h(
        Identity.Text,
        {},
        h(Identity.Name, {}, title),
        h(Identity.Note, {}, host),
      ),
      away
        ? h(
          Button,
          { href: away, target: '_blank', rel: 'noopener', 'data-open': '' },
          h(Icon, { of: ExternalLink }),
          'Open',
        )
        : null,
    ),
    h(
      'div',
      { class: 'Talk_Stage', 'aria-busy': making ? undefined : 'true' },
      opening ? null : h(
        TabSet,
        { class: 'Talk_Made', 'aria-label': `What ${title} is made of` },
        tab('keeps', 'Data', keeps(now.made, whose)),
        tab(
          'does',
          'Commands',
          does(
            now.made,
            whose,
            !!live,
            now.pages,
            now.draft
              ? { frame: 'draft', at: now.draft }
              : live
              ? { frame: 'live', at: live }
              : null,
          ),
        ),
        now.steps.length ? tab('runs', 'Workflow', runs(now.steps)) : null,
        tab(
          'preview',
          'Preview',
          preview(title, operator, live, now.draft, now.edited),
        ),
        now.drafts && tab(
          'drafts',
          [
            'Drafts',
            now.drafts.length > 0 && h(TabSet.Badge, null, now.drafts.length),
          ],
          draftList(app.eid, now.drafts),
        ),
      ),
    ),
  )
}

/** The bar's way to the app on a phone, named for it in one line, cut short
 * where the bar is narrow (pages.css). */
export let showing = (app: Pick<MarkedApp, 'slug' | 'title'>): Node =>
  h(
    Button,
    { href: '#app', class: 'Talk_Show', 'data-pane': '' },
    h(Toolbar.Label, {}, app.title || app.slug),
  )
