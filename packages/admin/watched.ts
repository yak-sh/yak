/** The source yaks.app's production build is made from: its Workers Builds
 * trigger's watch paths (workers/yak/README.md), as git pathspecs. The deploy
 * catch-up and the deploy door's guard compare these to find source that
 * needs a build. */
export let WATCHED = [
  'workers/yak',
  'packages',
  'src',
  'deno.json',
  'deno.lock',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  'bin/build-yak',
  'bin/build-tools',
  ':(exclude,glob)**/*_test.*',
  ':(exclude,glob)**/README.md',
  ':(exclude,glob).github/**',
  ':(exclude,glob)bench/**',
]
