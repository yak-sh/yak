import { entry, styles as appStyles } from '@yaks/browse/app'
// Build the same page and stylesheet the routes facet serves, into a static
// host's asset directory. The runtime only supplies mounts and authentication.
import { bundle } from '@yaks/cli/page'
import { everforest, kits, stylesheet } from '@yaks/ui'

export let assets = async (to: string) => {
  await Deno.mkdir(to, { recursive: true })
  let here = new URL('./', import.meta.url)
  await Promise.all([
    Deno.writeTextFile(
      `${to}/app.js`,
      await bundle(entry) as string,
    ),
    Deno.writeTextFile(
      `${to}/styles.css`,
      (await stylesheet({ kits, theme: everforest })) + '\n' +
        await Deno.readTextFile(
          appStyles,
        ),
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
if (import.meta.main) await assets(Deno.args[0])
