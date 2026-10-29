// The change's source checks accompany its selected tests. Passing test
// caches never stand in for a type check, and formatting is applied first.

let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)
let formatted = (path: string) =>
  /\.(?:[mc]?[jt]sx?|jsonc?|md|markdown|ya?ml|css|scss|html)$/.test(path)

export type Check = { name: string; args: string[] }

/** Commands for existing changed files and affected tests, including cached
 * passes. Only the change is formatted and linted; types follow consumers. */
export let checks = (changed: string[], affected: string[]): Check[] => {
  let fmt = changed.filter(formatted)
  let lint = changed.filter(code)
  let files = [...new Set([...changed, ...affected])]
  let types = files.filter(code)
  let docs = files.filter((p) => /\.(md|markdown)$/.test(p))
  return [
    ...fmt.length ? [{ name: 'format', args: ['fmt', ...fmt] }] : [],
    ...lint.length ? [{ name: 'lint', args: ['lint', ...lint] }] : [],
    ...types.length
      ? [{
        name: 'types',
        args: ['check', '--quiet', '--frozen', '--doc', ...types],
      }]
      : [],
    ...docs.length
      ? [{
        name: 'docs',
        args: ['check', '--quiet', '--frozen', '--doc-only', ...docs],
      }]
      : [],
  ]
}

/** A check's effect boundary. Tests supply this with controlled results. */
export let command = async ({ name, args }: Check): Promise<boolean> => {
  let result = await new Deno.Command(Deno.execPath(), {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    console.error(`FAILED ${name}`)
    console.error(new TextDecoder().decode(result.stdout))
    console.error(new TextDecoder().decode(result.stderr))
  }
  return result.success
}

/** Format before selecting: the files' keys must describe the bytes tested. */
export let format = async (
  changed: string[],
  run = command,
): Promise<string[]> => {
  let files = (await Promise.all(
    changed.map(async (path) =>
      await Deno.stat(path).then((s) => s.isFile, () => false) ? [path] : []
    ),
  )).flat()
  let fmt = checks(files, []).find((c) => c.name == 'format')
  if (fmt && !await run(fmt)) throw new Error('Formatting failed')
  return files
}

/** Lint and type checks run alongside one another after formatting. */
export let check = async (
  changed: string[],
  affected: string[],
  run = command,
) =>
  (await Promise.all(
    checks(changed, affected).filter((c) => c.name != 'format').map(run),
  )).every(Boolean)
