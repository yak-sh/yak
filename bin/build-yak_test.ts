import { fileURLToPath } from 'node:url'
import { assertEquals } from '@std/assert'

// Fake executables prove shell exit behavior without opening either deploy door.
Deno.test('build-yak: production precedes staging, and either failure fails Builds', async () => {
  let dir = await Deno.makeTempDir({
    dir: fileURLToPath(new URL('./', import.meta.url)),
    prefix: 'yak-build-',
  })
  try {
    await Deno.writeTextFile(
      `${dir}/npm`,
      '#!/bin/sh\nprintf "%s\\n" "$YAK_BUILD_CACHE"\n',
      { mode: 0o755 },
    )
    await Deno.writeTextFile(
      `${dir}/deno`,
      `#!/bin/sh
if [ "$1" = --version ]; then exit 0; fi
printf '%s\\n' "$*" >> "$YAK_BUILD_LOG"
printf '%s|%s\\n' "\${WRANGLER_CI_OVERRIDE_NAME:-}" "\${WRANGLER_CI_MATCH_TAG:-}" >> "$YAK_BUILD_GUARDS"
case "$2" in
  deploy:yak) exit "$YAK_BUILD_PRODUCTION_CODE" ;;
  deploy:yak-staging) exit "$YAK_BUILD_STAGING_CODE" ;;
  *) exit 99 ;;
esac
`,
      { mode: 0o755 },
    )
    for (
      let [production, staging, want] of [[0, 0, 0], [17, 0, 17], [0, 23, 23]]
    ) {
      let log = `${dir}/calls`
      let guards = `${dir}/guards`
      await Deno.writeTextFile(log, '')
      await Deno.writeTextFile(guards, '')
      let out = await new Deno.Command('sh', {
        args: [
          fileURLToPath(new URL('./build-yak', import.meta.url)),
          'deploy',
          '--dry-run',
        ],
        cwd: new URL('../workers/yak/', import.meta.url),
        env: {
          PATH: `${dir}:${Deno.env.get('PATH')}`,
          YAK_BUILD_CACHE: dir,
          YAK_BUILD_LOG: log,
          YAK_BUILD_GUARDS: guards,
          WRANGLER_CI_OVERRIDE_NAME: 'yak',
          WRANGLER_CI_MATCH_TAG: 'production-tag',
          YAK_BUILD_PRODUCTION_CODE: String(production),
          YAK_BUILD_STAGING_CODE: String(staging),
        },
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      assertEquals(out.code, want)
      assertEquals((await Deno.readTextFile(log)).trim().split('\n'), [
        'task deploy:yak --dry-run',
        ...(production ? [] : ['task deploy:yak-staging --dry-run']),
      ])
      assertEquals((await Deno.readTextFile(guards)).trim().split('\n'), [
        'yak|production-tag',
        ...(production ? [] : ['|']),
      ])
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
