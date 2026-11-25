/**
 * The app open beside the chat (T-140509), and the one the Operator is making
 * in it (D-146737), drawn from rows (./app-canvas.ts): its icon, its name and
 * where it lives, a way to open it in a tab of its own, and under them what
 * it is made of: Data, Commands, Workflow when it has one, and Screens, with
 * the newest stage of making it open. Its screens are the app itself, live,
 * or before it is released its draft, which follows each write. The app's
 * host lets the platform frame it (./kept.ts `sealed`). On a phone it takes
 * the screen in the chat's place while chosen (`#app`), and Chat goes back.
 *
 * Its head and live screens are drawn from the side's row of the app at once;
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
  Empty,
  Icon,
  Identity,
  Notice,
  Preview,
  TabSet,
  Toolbar,
} from '@yaks/ui/parts'
// @ts-types="@yaks/ui/lucide"
import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
// @ts-types="@yaks/ui/lucide"
import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs'
import { does, keeps, runs } from './app-made.ts'
import type { Making } from './app-canvas.ts'
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
}

/** Where the app's own address is, once released. */
export let liveAt = ({ at, app }: Pick<CanvasView, 'at' | 'app'>) =>
  app.source ? `${at}/${app.slug}/` : null

// Which of the canvas's tabs opens: the newest stage of making it reached,
// screens once there are any.
let stageOf = (live: string | null, { made, draft }: Making) =>
  live || draft
    ? 'screens'
    : !made.kinds.length && made.acts.length
    ? 'does'
    : 'keeps'

// Its screens: the draft while it differs from what is live, and the app
// itself once released, each in a frame, the one on screen said. While both
// are there a pair of radios switches them (pages.css shows the frame of the
// checked one, and the other loads once shown), the draft first, since it
// is what is changing.
let screens = (
  title: string,
  operator: string,
  live: string | null,
  draft: string | null,
) => {
  let frame = (which: 'draft' | 'live', at: string) => [
    h(Preview.Address, {
      href: at,
      target: '_blank',
      rel: 'noopener',
      title: 'Preview address, opens in a new tab',
      'data-address': which,
      'data-screen': which,
    }, at),
    h(Preview.Frame, {
      mod: 'flat',
      src: at,
      title: `${title}, ${which == 'draft' ? 'the draft' : 'live'}`,
      name: `screen-${which}`,
      'data-frame': which,
      'data-screen': which,
      ...which == 'live' && draft ? { loading: 'lazy' } : {},
    }),
  ]
  let note = (which: string, said: string) =>
    h(Notice, { mod: 'fine', 'data-screen': which }, said)
  if (!live && !draft) {
    return h(
      Empty,
      null,
      h('p', null, `${title}’s screens show here as ${operator} draws them.`),
    )
  }
  let choices = [
    draft &&
    {
      id: 'draft' as const,
      title: 'Draft',
      at: draft,
      note: live
        ? `${operator}’s changes, not live yet, over the live rows; what it writes stays in the draft.`
        : `A draft over the live rows, changing as ${operator} works on it; what it writes stays in the draft.`,
    },
    live &&
    {
      id: 'live' as const,
      title: 'Live',
      at: live,
      note: draft
        ? 'What people see now. The draft’s changes show here once released.'
        : '',
    },
  ].filter((x) => !!x)
  return h(
    Preview.Choices,
    { role: 'radiogroup', 'aria-label': 'Which screens' },
    choices.map((choice, i) =>
      h(
        Preview.Item,
        // Keyed, so a draft arriving beside the live screens leaves them
        // loaded where they are (@yaks/ui/navigate `morph`).
        { 'data-key': choice.id },
        choices.length > 1
          ? h(
            Preview.Choice,
            {},
            h(Check.Input, {
              type: 'radio',
              name: 'screen',
              value: choice.id,
              checked: i == 0,
            }),
            choice.title,
          )
          : null,
        h(
          Preview.View,
          {},
          choice.note ? note(choice.id, choice.note) : null,
          frame(choice.id, choice.at),
        ),
      )
    ),
  )
}

/** The app beside the chat, drawn from the side's row of it and, once in,
 * what it is made of, wearing `attrs` (`canvasAttrs`). Each part the browser
 * puts in place again as the Operator works is named by `data-part`. */
export let appCanvas = (
  view: CanvasView,
  making?: Making,
  attrs: Record<string, string> = {},
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
  let tab = (id: string, name: string, ...inside: Node[]) =>
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
          'data-compact': id == 'screens' ? '' : undefined,
        },
        h('div', { class: 'Talk_Sheet' }, ...inside),
      ),
    )
  return h(
    Preview,
    {
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
      h(
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
        tab('screens', 'Screens', screens(title, operator, live, now.draft)),
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
