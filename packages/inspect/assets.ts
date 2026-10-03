// Build the inspector's own page and UI kit for a static host. The host
// supplies the page mount and store API when it serves the document.
import { bundle } from '@yaks/cli/page'
import { everforest, kits, stylesheet } from '@yaks/ui'
import { entry, PAGE } from './routes.ts'

export let assets = async (to: string) => {
  await Deno.mkdir(to, { recursive: true })
  let main = new URL('./main.ts', import.meta.url)
  await Promise.all([
    Deno.writeTextFile(`${to}/index.html`, PAGE),
    Deno.writeTextFile(
      `${to}/app.js`,
      await bundle({ code: entry(main.href, []), at: main }) as string,
    ),
    Deno.writeTextFile(
      `${to}/styles.css`,
      await stylesheet({ kits, theme: everforest }),
    ),
  ])
}
if (import.meta.main) await assets(Deno.args[0])
