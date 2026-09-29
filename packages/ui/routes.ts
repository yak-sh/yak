/**
 * The routes facet, exported as `@yaks/ui/routes`: `/ui` answers the style
 * guide (guide.ts) as one static page, the kit's stylesheet inline. The
 * parts have no behaviour, so the page needs no script.
 *
 * @module
 */

import type { Route } from '@yaks/api'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { everforest } from './everforest.ts'
import { Guide } from './guide.ts'
import { stylesheet } from './kit.ts'

/** The style guide's page, dressed in `theme`. */
export let page = async (theme = everforest): Promise<string> =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<title>@yaks/ui</title><style>${await stylesheet(theme)}</style></head>` +
  `<body><main style="padding: var(--gap)">${
    renderToString(h(Guide, null))
  }</main></body></html>`

/** `GET /ui`: the style guide. */
export let routes = (): Route[] => [{
  method: 'GET',
  path: '/ui',
  handle: async () =>
    new Response(await page(), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
}]
