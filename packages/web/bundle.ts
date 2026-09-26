// The browser's code: main.tsx and everything it imports, bundled into one
// file by Deno's own bundler. Built once per process, like every other module
// a host loaded: a changed view reaches the browser when the server restarts,
// not before.
//
// From a checkout main.tsx is a file, and the bundler runs where this
// package's config is found, so the workspace resolves every import the way it
// does here. From JSR it is a URL, and the bundler runs in a directory of its
// own under the config a release resolves by (@yaks/cli/release): on the day
// this one published the rest of it is exactly as new, and a bundler waiting a
// day for it would find none.

import { released, scopeOf } from '@yaks/cli/release'

/** One file of browser JavaScript from `entry` (main.tsx), by `deno bundle`.
 * Aborting `signal` kills the bundler (kept.ts bounds it). */
export let bundle = async (
  signal?: AbortSignal,
  entry: URL = new URL('./main.tsx', import.meta.url),
): Promise<string> => {
  let dir = await Deno.makeTempDir({ prefix: 'yaks-web-' })
  try {
    let to = `${dir}/app.js`
    let scope = scopeOf(entry)
    if (scope) {
      let config = JSON.stringify(await released(scope))
      await Deno.writeTextFile(`${dir}/deno.json`, config)
    }
    let local = entry.protocol == 'file:'
    let run = await new Deno.Command(Deno.execPath(), {
      args: [
        'bundle',
        '--quiet',
        '--platform',
        'browser',
        '--minify',
        '-o',
        to,
        local ? entry.pathname : entry.href,
      ],
      cwd: local ? new URL('./', entry).pathname : dir,
      stdout: 'piped',
      stderr: 'piped',
      signal,
    }).output()
    if (signal?.aborted) throw new Error('deno bundle was stopped')
    if (!run.success) {
      throw new Error(
        `deno bundle failed: ${new TextDecoder().decode(run.stderr).trim()}`,
      )
    }
    return await Deno.readTextFile(to)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}
