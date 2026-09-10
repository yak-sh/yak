import { assert, assertEquals, assertThrows } from '@std/assert'
import { agent } from './run.ts'
import { open } from './store.ts'

// Where Deno keeps its module cache for this process, so a child that moves
// HOME can still be handed it.
let denoDir = () => {
  let configured = Deno.env.get('DENO_DIR')
  if (configured) return configured
  let home = Deno.env.get('HOME')
  if (Deno.build.os == 'darwin') return `${home}/Library/Caches/deno`
  if (Deno.build.os == 'windows') return `${Deno.env.get('LOCALAPPDATA')}\\deno`
  return `${Deno.env.get('XDG_CACHE_HOME') ?? `${home}/.cache`}/deno`
}

Deno.test('agent rejects a spread harness before opening a default database', () => {
  let h = open(':memory:')
  try {
    assertThrows(
      // @ts-expect-error A Harness belongs under h, including when spread.
      () => agent({ ...h, name: 'fake', tools: [] }),
      TypeError,
      'Pass the harness as agent({ h: open(...) })',
    )
  } finally {
    h.close()
  }
})

Deno.test('prompt admission tests never open the environment database', async () => {
  let home = await Deno.makeTempDir({ prefix: 'harness-isolation-' })
  let path = home + '/must-not-open.db'
  try {
    // Run the actual fixture with private defaults, not the invoking harness's
    // environment. This detects accidental fallback even if its assertions pass.
    let result = await new Deno.Command(Deno.execPath(), {
      args: [
        'test',
        '-A',
        new URL('./prompts_test.ts', import.meta.url).pathname,
      ],
      env: {
        // The harness paths move; the module cache must not. Deno resolves it
        // under HOME, so a redirected HOME alone makes the child download the
        // whole graph into a private cache — half a gigabyte of temp per run,
        // and a leak whenever the run never reaches the cleanup below.
        DENO_DIR: denoDir(),
        HOME: home,
        HARNESS_DB: path,
        HARNESS_ERROR_LOG: home + '/exceptions.jsonl',
      },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr))
    let names = Array.from(Deno.readDirSync(home), (entry) => entry.name)
    assert(
      !names.some((name) => name.startsWith('must-not-open.db')),
      names.join(', '),
    )
  } finally {
    await Deno.remove(home, { recursive: true })
  }
})
