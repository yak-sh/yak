// Run the split dispatcher regression in its own process. The production
// registry and live_db are process singletons by design; subprocess isolation
// lets this test model a fresh server/effectsd pair without changing DB_PATH or
// registering handlers in neighbouring test modules in the full-suite worker.
import { assert, assertStringIncludes } from '@std/assert'

Deno.test('split dispatcher launches graph-native Session without restart', async () => {
  let graph = `${Deno.makeTempDirSync()}/dispatch-split.db`
  let child = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', 'src/dispatch_split_probe.ts'],
    env: { DB_PATH: graph, TASKS_SYNC: 'off', TASKS_EMBED: '0' },
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let stderr = new TextDecoder().decode(child.stderr)
  assert(child.success, stderr)
  assertStringIncludes(
    new TextDecoder().decode(child.stdout),
    'split dispatcher launched graph-native session',
  )
})
