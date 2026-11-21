// Deno's explicit file arguments override configuration exclusions unless the
// exclusions are supplied through --ignore. Deno retains ownership of glob
// matching, file-type support and all formatting options. A checkout without
// a Deno config never chose Deno's formatter, so it is not formatted: Deno's
// defaults would rewrite a Rails app's Markdown and YAML it never authored.
import { parse } from '@std/jsonc'
import * as disk from '@yaks/file/io'

let object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)
let paths = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((path): path is string => typeof path == 'string')
    : []

export let formatting = (
  files: string[],
  config: unknown,
  file = 'deno.json',
): string[] => {
  let root = object(config) ? config : {}
  let fmt = object(root.fmt) ? root.fmt : {}
  return [
    'fmt',
    '--config',
    file,
    '--permit-no-files',
    ...[...new Set([...paths(root.exclude), ...paths(fmt.exclude)])]
      .map((path) => '--ignore=' + path),
    ...files,
  ]
}

let read = (path: string) =>
  disk.readTextFile(path).catch((e) => {
    if (disk.isNotFound(e)) return undefined
    throw e
  })

/** The checkout's Deno config, or undefined when it has none. */
export let formatConfig = async (
  cwd: string,
  source: (path: string) => Promise<string | undefined> = read,
): Promise<{ file: string; config: unknown } | undefined> => {
  for (let file of ['deno.json', 'deno.jsonc']) {
    let text = await source(disk.join(cwd, file))
    if (text != null) return { file, config: parse(text) ?? {} }
  }
}
