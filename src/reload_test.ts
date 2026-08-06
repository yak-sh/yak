// The handoff boundary is a path predicate: server imports restart the process,
// while browser modules stay inside the existing hot-swap loop.
import { assertEquals } from '@std/assert'
import { devFile, serverFile } from './reload.ts'

Deno.test('serverFile: recognizes the backend graph only', () => {
  for (
    let [path, want] of [
      ['/repo/src/server.ts', true],
      ['/repo/src/reload.ts', true],
      ['/repo/src/tmux.ts', true],
      ['/repo/src/roles.ts', true],
      ['/repo/src/ground.ts', true],
      ['/repo/src/components/Card.tsx', false],
      ['/repo/src/styles.css', false],
      ['/repo/src/server.ts.old', false],
    ] as [string, boolean][]
  ) assertEquals(serverFile(path), want, path)
})

// A sampled list cannot fail for the name it is missing, and the supervisor's
// graph is small enough to state universally: whatever dev.ts imports IS its
// source, and a landed change to any of it must ask for a relaunch.
Deno.test('devFile: covers everything the supervisor imports', async () => {
  let dev = await Deno.readTextFile(new URL('./dev.ts', import.meta.url))
  let imports = [...dev.matchAll(/from '\.\/([\w.]+)'/g)].map((m) => m[1])
  assertEquals(imports.length > 0, true) // the regex still finds them
  for (let name of [...imports, 'dev.ts']) {
    assertEquals(devFile(`/repo/src/${name}`), true, name)
  }
  assertEquals(devFile('/repo/src/server.ts'), false)
})
