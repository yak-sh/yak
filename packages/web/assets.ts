import type { Application } from './app.ts'
// Build the same page and stylesheet the routes facet serves, into a static
// host's asset directory. The runtime only supplies mounts and authentication.
import { bundle } from '@yaks/cli/page'
import { everforest, kits, stylesheet } from '@yaks/ui'

export let assets = async (to: string, app: Application) => {
  await Deno.mkdir(to, { recursive: true })
  let here = new URL('./', import.meta.url)
  await Promise.all([
    Deno.writeTextFile(
      `${to}/app.js`,
      await bundle({
        code: `import ${
          JSON.stringify(new URL('./browser.ts', import.meta.url).href)
        }; import ${JSON.stringify(app.entry.href)}`,
        at: app.entry,
      }) as string,
    ),
    Deno.writeTextFile(
      `${to}/styles.css`,
      (await stylesheet({ kits, theme: everforest })) + '\n' +
        (app.styles ? await Deno.readTextFile(app.styles) : ''),
    ),
    ...[
      'index.html',
      'manifest.webmanifest',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
      'apple-touch-icon.png',
    ].map((name) => Deno.copyFile(new URL(name, here), `${to}/${name}`)),
  ])
}
if (import.meta.main) {
  if (!Deno.args[1]) throw new Error('assets needs an application ./web module')
  let { app } = await import(Deno.args[1])
  await assets(Deno.args[0], app)
}
