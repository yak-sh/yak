// The browser module graph must stay inside src/, the server's one static
// root. Deno can resolve an import outside it, so typechecking alone cannot
// catch a module that becomes a production 404.
import { assert } from '@std/assert'

let imports =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"']+)\1/g

Deno.test('browser modules stay inside the served source root', async () => {
  let root = new URL('.', import.meta.url)
  let queue = [new URL('main.tsx', root)]
  let seen = new Set<string>()
  while (queue.length) {
    let file = queue.shift()!
    if (seen.has(file.href)) continue
    seen.add(file.href)
    let source = await Deno.readTextFile(file)
    for (let match of source.matchAll(imports)) {
      let child = new URL(match[2], file)
      child.search = ''
      assert(
        child.href.startsWith(root.href),
        `${file.pathname} imports outside the static root: ${match[2]}`,
      )
      if (/\.[jt]sx?$/.test(child.pathname)) queue.push(child)
    }
  }
})
