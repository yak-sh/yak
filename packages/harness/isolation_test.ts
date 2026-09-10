import { assert, assertEquals, assertThrows } from '@std/assert'
import { agent } from './run.ts'
import { open } from './store.ts'

Deno.test('HARNESS_HOME isolates default storage and diagnostics without moving HOME', async () => {
  let home = await Deno.makeTempDir({ prefix: 'harness-defaults-' })
  try {
    let result = await new Deno.Command(Deno.execPath(), {
      args: [
        'eval',
        `import { open } from ${
          JSON.stringify(new URL('./store.ts', import.meta.url).href)
        };
         import { diagnostics } from ${
          JSON.stringify(new URL('./diagnostics.ts', import.meta.url).href)
        };
         let h = open(); h.close();
         diagnostics().report(new Error('isolated probe'), { phase: 'test' });`,
      ],
      env: { HARNESS_HOME: home, HARNESS_DB: '', HARNESS_ERROR_LOG: '' },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr))
    assert(Deno.statSync(home + '/harness.db').isFile)
    assert(
      Deno.readTextFileSync(home + '/exceptions.jsonl').includes(
        'isolated probe',
      ),
    )
    assert(
      !Array.from(Deno.readDirSync(home)).some((entry) =>
        entry.name == '.cache'
      ),
    )
  } finally {
    await Deno.remove(home, { recursive: true })
  }
})

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
        HARNESS_HOME: home,
        TASKS_HOME: home,
        HARNESS_DB: path,
        HARNESS_ERROR_LOG: '',
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
