// tsgo's command line checks every imported source body. Its program API
// resolves the same complete program, but can check just the selected files:
// dependencies still supply their inferred types without becoming more work.
import type { Diagnostic } from 'typescript-native/unstable/async'

/** The native program's diagnostic doors, without starting a compiler. */
export type Program = {
  getProgramDiagnostics(): Promise<readonly Diagnostic[]>
  getConfigFileParsingDiagnostics(): Promise<readonly Diagnostic[]>
  getSyntacticDiagnostics(file: string): Promise<readonly Diagnostic[]>
  getBindDiagnostics(file: string): Promise<readonly Diagnostic[]>
  getSemanticDiagnostics(file: string): Promise<readonly Diagnostic[]>
}

/** Diagnostics of the project and the selected sources, including parsing
 * and binding failures. Imported types remain part of the native program.
 * Whole-program global diagnostics belong to --all: the native API's global
 * request checks every imported body before returning those diagnostics. */
export let diagnostics = async (program: Program, roots: string[]) => {
  let found = (await Promise.all([
    program.getProgramDiagnostics(),
    program.getConfigFileParsingDiagnostics(),
    ...roots.flatMap((root) => [
      program.getSyntacticDiagnostics(root),
      program.getBindDiagnostics(root),
      program.getSemanticDiagnostics(root),
    ]),
  ])).flat()
  return [...new Map(found.map((d) => [JSON.stringify(d), d])).values()]
}

/** The native API's process lifetime, with a boundary tests can supply. */
export type API = {
  updateSnapshot(params: { openProjects: string[] }): Promise<{
    getProject(config: string): { program: Program } | undefined
  }>
  close(): Promise<void>
}

/** Check one project and always close its compiler, including on failure. */
export let check = async (api: API, config: string, roots: string[]) => {
  try {
    let snapshot = await api.updateSnapshot({ openProjects: [config] })
    let project = snapshot.getProject(config)
    if (!project) throw new Error(`Cannot open native type project ${config}`)
    return await diagnostics(project.program, roots)
  } finally {
    await api.close()
  }
}

let message = (d: Diagnostic): string =>
  [d.text, ...d.messageChain?.map(message) ?? []].join('\n  ')

/** A native diagnostic in the command line format check-types reports. */
export let format = (
  d: Diagnostic,
  read = (path: string) => Deno.readTextFileSync(path),
  cwd = Deno.cwd(),
): string => {
  if (!d.fileName) return `error TS${d.code}: ${message(d)}`
  let before = read(d.fileName).slice(0, Math.max(0, d.pos)).split('\n')
  let file = d.fileName.startsWith(cwd + '/')
    ? d.fileName.slice(cwd.length + 1)
    : d.fileName
  return `${file}(${before.length},${
    before.at(-1)!.length + 1
  }): error TS${d.code}: ${message(d)}`
}

if (import.meta.main) {
  let [config, ...roots] = Deno.args
  let { API } = await import('typescript-native/unstable/async')
  let errors = await check(new API({ cwd: Deno.cwd() }), config, roots)
  if (errors.length) {
    console.log(errors.map((d) => format(d)).join('\n'))
    Deno.exitCode = 1
  }
}
