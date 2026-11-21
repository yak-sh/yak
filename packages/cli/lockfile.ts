// Whether a checkout's node_modules was installed from its lockfile. It
// imports nothing, so the installer's bootstrap (bin/workspace-dependencies.ts)
// can ask before node_modules exists, when no workspace package resolves.

/** The lockfile a checkout at root wants installed. */
export let wanted = (root: string): string => `${root}/pnpm-lock.yaml`

/** pnpm's copy of the lockfile it last installed at root, without the
 * document that pins pnpm itself. */
export let current = (root: string): string =>
  `${root}/node_modules/.pnpm/lock.yaml`

// A formatter may have rewrapped the lockfile's flow mappings (`{ a: 1, }` over
// three lines where pnpm writes `{a: 1}`): its whitespace and trailing commas
// are not what pnpm installed.
let packages = (lock?: string) =>
  lock?.split(/^---\n/m).at(-1)?.replace(/\s+/g, '').replaceAll(',}', '}')

/// differs('a', 'a') -> false
/// differs('---\npnpm: 12\n\n---\na', 'a') -> false
/// differs('a: {\n  b: 1,\n}\n', 'a: {b: 1}') -> false
/// differs('a', 'b') -> true
/// differs('a', undefined) -> true
/// differs(undefined, undefined) -> false
/** Whether what pnpm installed (`current`'s text) is not the lockfile wanted. */
export let differs = (wanted?: string, installed?: string): boolean =>
  packages(wanted) !== packages(installed)
