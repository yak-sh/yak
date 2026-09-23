// The browser's code, built for one host: a module that imports every listed
// plugin's `./views` and the keywords of its `./vocab`, and hands them to
// ./client.ts `boot`, bundled into one file by Deno's own bundler. Which views
// a page can draw is therefore the config's to say, the same way its
// components are, and no list of packages is written down here.
//
// Built on the first request for it and kept for the life of the process, like
// every other module a host loaded: a changed view reaches the browser when
// the server restarts, not before.

/** What a config lists: a package name, or one with options. */
export type Plug = string | { use: string }

let named = (p: Plug) => (typeof p == 'string' ? p : p.use)

// A subpath the package does not export is one it does not have.
let resolved = (spec: string): string | undefined => {
  try {
    return import.meta.resolve(spec)
  } catch {
    return undefined
  }
}

/** The module the bundler starts from: each listed plugin's views and
 * keywords, in config order, and the call that starts the app. This package's
 * own views are the catch-all the app registers last, so they are left out. */
export let entry = (name: string, plugins: Plug[]): string => {
  let lines = [
    `import { boot } from ${JSON.stringify(resolved('./client.ts'))}`,
  ]
  let views: string[] = []
  let keywords: string[] = []
  for (let [i, plug] of plugins.map(named).entries()) {
    let v = plug == '@yaks/web' ? undefined : resolved(`${plug}/views`)
    let k = resolved(`${plug}/vocab`)
    if (v) {
      lines.push(`import * as v${i} from ${JSON.stringify(v)}`)
      views.push(`v${i}.views`)
    }
    if (k) {
      lines.push(`import * as k${i} from ${JSON.stringify(k)}`)
      keywords.push(`...(k${i}.keywords ?? [])`)
    }
  }
  lines.push(
    `boot({ name: ${JSON.stringify(name)}, views: [${views.join(', ')}], ` +
      `keywords: [${keywords.join(', ')}] })`,
  )
  return lines.join('\n') + '\n'
}

/** One file of browser JavaScript from a module's source, by `deno bundle`.
 * Run where this package's own config is found, so the workspace (or, once
 * published, the registry) resolves every import the way it does here. */
export let bundle = async (source: string): Promise<string> => {
  let dir = await Deno.makeTempDir({ prefix: 'yaks-web-' })
  try {
    let from = `${dir}/entry.ts`
    let to = `${dir}/client.js`
    await Deno.writeTextFile(from, source)
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
        from,
      ],
      cwd: here.protocol == 'file:' ? here.pathname : undefined,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
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
