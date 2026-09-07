// Use the kernel's pinned Wrangler. This Worker has no npm runtime imports.
import { WRANGLER } from '../yak/wrangler.ts'

if (import.meta.main) {
  let [cmd, ...args] = WRANGLER
  let { code } = await new Deno.Command(cmd, {
    args: [...args, ...Deno.args],
    cwd: new URL('./', import.meta.url),
  }).spawn().status
  Deno.exit(code)
}
