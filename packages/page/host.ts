// What a config says to this plugin, built.
//
// Two things about freezing a page are the HOST's and not the graph's: which
// external tool turns a live URL into one self-contained document, and where
// the resulting document goes. Neither is a fact anybody could read off an
// entity, so the config names them beside the plugin and this module makes
// them:
//
// ```json
// { "use": "@yaks/page",
//   "with": { "archive": { "run": ["monolith", "-j", "-f", "-I", "-q", "{url}"],
//                          "timeout": 60000 },
//             "bytes": "/var/lib/yak/frozen" } }
// ```
//
// A host that names no archiver gets no fetching — which is exactly what a
// graph that is only witnessed BY A BROWSER wants, since those bytes arrive
// through the door and were never going to be refetched.

import type { Driver } from '@yaks/sqlite'
import { type Blobs, blobSchema, fileBlobs, sqliteBlobs } from '@yaks/blob'
import type { Archive } from './freeze.ts'

/** What a config says to `@yaks/page`. */
export type Options = {
  /** the external tool that archives a live URL, and how long it may take */
  archive?: Run
  /** a directory the frozen documents go in; the host's own blob table
   * otherwise */
  bytes?: string
}

/** An archiver, as a config names one. */
export type Run = {
  /** the command and its arguments; `{url}` in an argument is the address,
   * and where no argument mentions it the address is appended */
  run: string[]
  /** how long it may take, in milliseconds (default 60 seconds) */
  timeout?: number
}

let decoder = new TextDecoder()

/**
 * A named tool, as an {@link Archive}. The document comes back on STDOUT —
 * there is no temporary file to name, collide over, or leave behind, and the
 * bytes are addressed by their content the moment they arrive.
 *
 * ```ts
 * import { archiver } from '@yaks/page'
 *
 * let archive = archiver({ run: ['monolith', '-j', '-f', '-I', '-q', '{url}'] })
 * ```
 */
export let archiver = ({ run, timeout = 60_000 }: Run): Archive => {
  let [cmd, ...rest] = run
  if (!cmd) {
    throw new Error(
      '@yaks/page: `archive.run` names a command and its arguments',
    )
  }
  return async (url) => {
    let said = rest.map((a) => a.replaceAll('{url}', url))
    let args = said.some((a, i) => a != rest[i]) ? said : [...said, url]
    let out = await new Deno.Command(cmd, {
      args,
      stdout: 'piped',
      stderr: 'piped',
      signal: AbortSignal.timeout(timeout),
    }).output()
    if (!out.success) {
      throw new Error(
        `${cmd}: ${decoder.decode(out.stderr).trim() || `exit ${out.code}`}`,
      )
    }
    // An archiver that answered nothing archived nothing. Storing the empty
    // document would stamp the page frozen and leave a reader with a blank.
    let html = decoder.decode(out.stdout)
    if (!html.trim()) throw new Error(`${cmd}: ${url} archived to nothing`)
    return html
  }
}

/**
 * Where this host's frozen documents live.
 *
 * The default is the blob table the host already has — the same one
 * @yaks/blob keeps its text columns in, so a page's bytes are not a second
 * store to configure, back up or serve, and `GET /blob/<sha>` answers for
 * them as it does for everything else. A frozen page is one document with
 * every asset inlined and is therefore often megabytes, so a host that would
 * rather not carry that in its database names a directory instead.
 *
 * The table is raised here as well as in `@yaks/blob/rules`, because a host
 * may compose this plugin without that one; `create table if not exists` is
 * what makes saying it twice free.
 */
export let blobsOf = (host: { sql: Driver }, options: Options = {}): Blobs => {
  if (options.bytes) return fileBlobs(options.bytes)
  for (let statement of blobSchema()) host.sql.exec(statement)
  return sqliteBlobs(host.sql)
}
