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
            'default true; false returns the private preview address without running a browser',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => (await import('./preview.ts')).preview(ctx, args),
  } satisfies Row,
)]
