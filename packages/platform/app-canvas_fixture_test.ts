import type { Bundle } from '@yaks/graph'
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { appRows, sideApps } from './side-rows.ts'
import { appMaking, type Making, makingRow } from './app-canvas.ts'
import { appCanvas, canvasAttrs, type CanvasRoot } from './app-canvas-view.ts'
import type { MarkedApp } from './routes.ts'

export let ADA = 'ada-person'
export let SPACE = 'plum-space'
export let RECIPES: MarkedApp = {
  eid: 'recipes-app',
  slug: 'recipes',
  title: 'Recipe box',
  source: null,
}

/** Released, as its row says once its first release lands. */
export let released = (app = RECIPES): MarkedApp => ({
  ...app,
  source: `plum/.releases/${app.eid}/1`,
})

export let view = (app = RECIPES): CanvasRoot => ({
  at: 'https://plum.yaks.app',
  operator: 'Otto',
  app,
  person: ADA,
  space: SPACE,
})

/** What the app is made of, with `kinds` its kinds' names. */
export let made = (
  kinds: string[] = [],
  draft: string | null = null,
): Making => ({
  made: {
    kinds: kinds.map((name) => ({ name, holds: ['Name'] })),
    acts: [],
    finds: [],
  },
  pages: [],
  steps: [],
  draft,
})

/** The canvas as the server draws it for `root`, before what it is made of
 * is in. */
export let page = (root = view(), making?: Making): HTMLElement => {
  let html = renderToString(
    h(Fragment, null, appCanvas(root, making, canvasAttrs(root))),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return settled(document.querySelector<HTMLElement>('[data-view]')!)
}

/** `root` with each radio linkedom made unchecked by its property checked as
 * its markup says, as a browser's starts. */
export let settled = (root: HTMLElement): HTMLElement => {
  for (let r of root.querySelectorAll<HTMLInputElement>('[type=radio]')) {
    r.checked ??= r.hasAttribute('checked')
  }
  return root
}

/** The page graph's lines for the canvas: the side's rows of `apps`, and
 * what the first of them is made of, when given. */
export let lines = (
  apps: MarkedApp[],
  making?: Making,
): [string, Bundle[]][] => [
  [sideApps(SPACE), appRows(ADA, SPACE, apps)],
  [
    appMaking(apps[0].eid),
    making ? [makingRow(ADA, apps[0].eid, making)] : [],
  ],
]
