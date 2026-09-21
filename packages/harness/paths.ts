/** Harness state can move without moving HOME (and Deno's module cache). */
export let home = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_HOME') || `${env('HOME') || '.'}/.yak`

/** Where a task child's checkout lands: `$HARNESS_WORKTREE_DIR`, else beside
 * the rest of the harness's state. */
export let worktrees = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_WORKTREE_DIR') || `${home(env)}/worktrees`
