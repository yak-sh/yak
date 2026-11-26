// The preview tool's declaration stays separate from its request runtime:
// the roster is needed while the app and preview routers are loading.
import { APP, runOf, SPACE, str } from './tool.ts'
import { type Row, worded } from './tool-words.ts'

export let tools = [worded(
  {
    name: 'app_preview',
    destructive: false,
    openWorld: true,
    outlasts: (args, ctx) => ({ key: runOf(args, ctx) }),
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
        steps: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              tap: str('click the visible element matching this selector'),
              type: str('type this text'),
              into: str(
                'with type, focus the visible element matching this selector',
              ),
              press: str('press a key, such as Enter'),
              wait: { type: 'integer', minimum: 0, maximum: 3000 },
            },
          },
          description:
            'Interact in the browser in order before taking the screenshot. Each step is tap, type (optionally with into), press, or wait. Released actions run with your live permissions.',
        },
        draft: str(
          'Pass an open draft id when several drafts are open. Omit draft to ' +
            'show the only open draft. Released or discarded ids are closed. ' +
            'Use released: true for the live app, or write with app_files ' +
            'without draft to open a new draft when none are open.',
        ),
        released: {
          type: 'boolean',
          description:
            'true opens the released app at its own address with its live data, as a visitor sees a public app and as you see a private one, instead of the draft; check a page with it after app_deploy or after writing rows',
        },
        keep: {
          type: 'boolean',
          description:
            "with released: true, keeps the screenshot as the picture of the live version, which stays that version's when the app moves on; the space owner's",
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => (await import('./preview.ts')).preview(ctx, args),
  } satisfies Row,
)]
