// What the page must hold for a browser that reaches it over plain http on a
// phone: the shell does not scale, and nothing mints ids through an API a
// non-secure context lacks.
import { assert } from '@std/assert'

let here = new URL('.', import.meta.url)

Deno.test('the mobile viewport does not scale the app shell', async () => {
  let html = await Deno.readTextFile(new URL('index.html', here))
  let viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)
  assert(viewport, 'index.html has no viewport metadata')
  let content = new Set(viewport[1].split(',').map((part) => part.trim()))
  assert(content.has('maximum-scale=1'))
  assert(content.has('user-scalable=no'))
})

// crypto.randomUUID is gated to SECURE contexts, and this page is served over
// plain http on the tailnet — there the property is simply not a function, so
// the first write throws out of a layout effect and the canvas never paints.
// types.ts `uuid` (and @yaks/id `mint`) build a v4 from getRandomValues, which
// is gated nowhere. The page's code mints through those, always.
Deno.test('page code mints uuids outside a secure context', async () => {
  let gated: string[] = []
  let walk = async (dir: URL) => {
    for await (let entry of Deno.readDir(dir)) {
      let url = new URL(entry.name + (entry.isDirectory ? '/' : ''), dir)
      if (entry.isDirectory) await walk(url)
      else if (/(?<!_test|_bench)\.tsx?$/.test(entry.name)) {
        let source = await Deno.readTextFile(url)
        if (source.includes('crypto.randomUUID(')) gated.push(entry.name)
      }
    }
  }
  await walk(here)
  assert(
    !gated.length,
    `${gated.join(', ')} name crypto.randomUUID(), which is absent on plain ` +
      `http — mint with uuid() from types.ts (or mint() from @yaks/id)`,
  )
})
