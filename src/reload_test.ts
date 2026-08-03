// The handoff boundary is a path predicate: server imports restart the process,
// while browser modules stay inside the existing hot-swap loop.
import { assertEquals } from '@std/assert'
import { serverFile } from './reload.ts'

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
