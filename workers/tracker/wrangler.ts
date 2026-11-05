#!/usr/bin/env -S deno run -A
// The independent build door reuses the workspace's dependencies and pinned
// Wrangler, but never deploys yak or its sibling Workers.
import { WRANGLER } from '../yak/wrangler.ts'
import { fileURLToPath } from 'node:url'
import { installed } from '@yaks/cli/dependencies'

export let root = fileURLToPath(new URL('./', import.meta.url)).replace(
  /\/$/,
  '',
)
export let ready = () => installed()
export let run = async (args: string[]) => {
  await ready()
  let child = new Deno.Command(WRANGLER[0], {
    args: [...WRANGLER.slice(1), ...args],
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  return (await child.status).code
}
if (import.meta.main) Deno.exit(await run(Deno.args))
