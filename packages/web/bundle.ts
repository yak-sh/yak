// The browser's code: main.tsx and everything it imports, bundled into one
// file by Deno's own bundler. Built once per process, like every other module
// a host loaded: a changed view reaches the browser when the server restarts,
// not before.

/** One file of browser JavaScript from main.tsx, by `deno bundle`, run where
 * this package's config is found so the workspace resolves every import the
 * way it does here. Aborting `signal` kills the bundler (kept.ts bounds it). */
export let bundle = async (signal?: AbortSignal): Promise<string> => {
  let dir = await Deno.makeTempDir({ prefix: 'yaks-web-' })
  try {
    let to = `${dir}/app.js`
    let here = new URL('./', import.meta.url)
    let run = await new Deno.Command(Deno.execPath(), {
      args: [
        'bundle',
        '--quiet',
        '--platform',
        'browser',
        '--minify',
        '-o',
        to,
        new URL('./main.tsx', here).pathname,
      ],
      cwd: here.pathname,
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
