// The fleet's shared worktree ground. Working copies stay outside the hidden
// data home because tools may treat any hidden ancestor as an instruction to
// ignore or include different files. The old root remains compatibility ground
// while sessions born there finish and their trees age out.

let roots = (home: string, chosen?: string) =>
  chosen != null
    ? [chosen]
    : [`${home}/tasks-worktrees`, `${home}/.tasks/worktrees`]

export let worktreeDirs = (
  home = String(Deno.env.get('HOME') ?? ''),
  chosen = Deno.env.get('WORKTREES_DIR'),
) => roots(home, chosen)

export let worktreesDir = () => worktreeDirs()[0]
export let legacyWorktreesDir = () => worktreeDirs().at(-1) ?? worktreesDir()
