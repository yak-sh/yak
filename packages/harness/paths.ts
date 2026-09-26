/** Harness state can move without moving HOME (and Deno's module cache). */
export let home = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_HOME') || `${env('HOME') || '.'}/.yak`

/** Where a task child's checkout lands: `$HARNESS_WORKTREE_DIR`, else beside
 * the rest of the harness's state. */
export let worktrees = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_WORKTREE_DIR') || `${home(env)}/worktrees`

/** The graph in the harness's home: `$HARNESS_DB`, else `yak.db` there. The
 * one a terminal's drafts are kept for, and the only one whose run may sweep
 * the worktree root. */
export let dbPath = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_DB') || `${home(env)}/yak.db`
