// The configuration this plugin reads, turned into the objects it uses.
//
// Two things about archiving a page belong to the server and not to the graph:
// which external command turns a live URL into one self-contained document, and
// where the resulting document is stored. Neither is a fact anybody could read
// off an entity, so the configuration names them beside the plugin and this
// module builds them:
//
// ```json
// { "use": "@yaks/page",
//   "with": { "archive": { "run": ["monolith", "-j", "-f", "-I", "-q", "{url}"],
//                          "timeout": 60000 },
//             "bytes": "/var/lib/yak/frozen" } }
// ```
//
// A server configured with no archiver fetches nothing — which is exactly what
// a graph fed only BY A BROWSER wants, since those bytes arrive over
// `POST /page` and were never going to be refetched.

import type { Driver } from '@yaks/sqlite'
import { type Blobs, blobSchema, fileBlobs, sqliteBlobs } from '@yaks/blob'
import type { Archive } from './freeze.ts'

/** The configuration `@yaks/page` reads. */
export type Options = {
  /** the external command that archives a live URL, and how long it may take */
  archive?: Run
  /** a directory the archived documents are written to; the server's own blob
   * table otherwise */
  bytes?: string
}

/** An archiver, as the configuration names one. */
export type Run = {
  /** the command and its arguments; `{url}` in an argument is replaced with the
   * address, and where no argument mentions it the address is appended */
  run: string[]
  /** how long it may take, in milliseconds (default 60 seconds) */
  timeout?: number
}

let decoder = new TextDecoder()

/**
 * A named command, wrapped as an {@link Archive}. The document is read from the
 * command's STDOUT — there is no temporary file to name, collide over, or leave
 * behind, and the bytes are addressed by their content the moment they arrive.
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
    // A command that printed nothing archived nothing. Storing the empty
    // document would stamp the page archived and leave a reader with a blank.
    let html = decoder.decode(out.stdout)
    if (!html.trim()) throw new Error(`${cmd}: ${url} archived to nothing`)
    return html
  }
}

/**
 * Where this server's archived documents are stored.
 *
 * The default is the blob table the server already has — the same one
 * @yaks/blob keeps its text columns in, so a page's bytes are not a second
 * store to configure, back up and serve, and `GET /blob/<sha>` serves them as
 * it does everything else. An archived page is one document with every asset
 * inlined and is therefore often megabytes, so a server that would rather not
 * carry that in its database names a directory instead.
 *
 * The table is created here as well as in `@yaks/blob/rules`, because a server
 * may load this plugin without that one; `create table if not exists` is what
 * makes running both statements harmless.
 */
export let blobsOf = (host: { sql: Driver }, options: Options = {}): Blobs => {
  if (options.bytes) return fileBlobs(options.bytes)
  for (let statement of blobSchema()) host.sql.exec(statement)
  return sqliteBlobs(host.sql)
}
