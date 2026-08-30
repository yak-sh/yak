// Run the split dispatcher regression in its own process. The production
// registry and live_db are process singletons by design; subprocess isolation
// lets this test model a fresh server/effectsd pair without changing DB_PATH or
// registering handlers in neighbouring test modules in the full-suite worker.
import { assert, assertStringIncludes } from '@std/assert'
import { slow } from './testing.ts'

slow(
  'split dispatcher launches graph-native Session without restart',
  async () => {
    let root = Deno.makeTempDirSync({ prefix: 'tasks-dispatch-split-' })
    try {
      let home = `${root}/home`, tmp = `${root}/tmp`
      Deno.mkdirSync(home)
      Deno.mkdirSync(tmp)
      let env = {
        DB_PATH: `${root}/graph.db`,
        DENO_DIR: `${root}/deno`,
        HOME: home,
        PATH: Deno.env.get('PATH') ?? '',
        TASKS_BACKOFF: '',
        TASKS_EMBED: '0',
        TASKS_SYNC: 'off',
        TMPDIR: tmp,
      }
      let command = (args: string[]) =>
        new Deno.Command(Deno.execPath(), {
          args,
          clearEnv: true,
          cwd: Deno.cwd(),
          env,
          stdout: 'piped',
          stderr: 'piped',
        }).output()
      let cached = await command([
        'cache',
        '--frozen',
        'src/dispatch_split_probe.ts',
      ])
      assert(cached.success, new TextDecoder().decode(cached.stderr))

      let child = await command([
        'run',
        '--cached-only',
        '--frozen',
        '-A',
        'src/dispatch_split_probe.ts',
      ])
      let stderr = new TextDecoder().decode(child.stderr)
      assert(child.success, stderr)
      assertStringIncludes(
        new TextDecoder().decode(child.stdout),
        'split dispatcher launched one retained-failure retry',
      )
    } finally {
      Deno.removeSync(root, { recursive: true })
    }
  },
)
