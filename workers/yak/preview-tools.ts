// The preview tool's declaration stays separate from its request runtime:
// the roster is needed while the app and preview routers are loading.
import { APP, SPACE, str } from './tool.ts'
import { type Row, worded } from './tool-words.ts'

export let tools = [worded(
  {
    name: 'app_preview',
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        path: str(
          'page relative to the app root, e.g. about/; defaults to the front page',
        ),
        width: {
          type: 'integer',
          minimum: 240,
          maximum: 2560,
          description:
            'viewport CSS pixels; 390 for a phone, 1280 for a desktop (default)',
        },
        height: {
          type: 'integer',
          minimum: 240,
          maximum: 2560,
          description: 'viewport CSS pixels; default 900',
        },
        wait: {
          type: 'integer',
          minimum: 0,
          maximum: 3000,
          description:
            'milliseconds to capture logs and render after DOMContentLoaded; default 1000',
        },
        screenshot: {
          type: 'boolean',
          description:
            'default true; false returns the address without running a browser',
        },
        draft: str(
          "the id of the draft to show, from app_files: each draft has a link and a test store of its own. Left out, this conversation's own draft, else your one open draft",
        ),
        released: {
          type: 'boolean',
          description:
            'true opens the released app at its own address with its live data, as a visitor sees a public app and as you see a private one, instead of the draft; check a page with it after app_deploy or after writing rows',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => (await import('./preview.ts')).preview(ctx, args),
  } satisfies Row,
)]
