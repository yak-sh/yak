// The page the routes facet serves (./routes.ts), written into a static host's
// asset directory (./assets.ts `write`): the application's script, the page
// and what it wears. The host supplies only the mounts and authentication.
//
//   deno run -A packages/web/static.ts <dir> <an application's ./web module>
import * as system from '@yaks/process/system'
import type { Application } from './app.ts'
import { type Asset, write } from './assets.ts'
import { dressing } from './page.ts'

/** What a static host serves of `app`. */
export let statics = (app: Application): Asset[] => [
  {
    name: 'app.js',
    bundle: {
      code: `import ${
        JSON.stringify(new URL('./browser.ts', import.meta.url).href)
      }; import ${JSON.stringify(app.entry.href)}`,
      at: app.entry,
    },
  },
  { name: 'index.html', file: new URL('./index.html', import.meta.url) },
  ...dressing(() => Promise.resolve(app)),
]

if (import.meta.main) {
  if (!system.args[1]) {
    throw new Error('static needs an application ./web module')
  }
  let { app } = await import(system.args[1])
  await write(system.args[0], statics(app))
}
