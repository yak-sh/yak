// Deno's incremental type information is keyed by the first root URL. Keep
// that URL and the checkout's module URLs stable across worktrees. The lock
// holds the alias still while Deno reads, including when the command fails.
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Check } from './test-checks.ts'
import { anchors } from './test-typecheck-anchors.ts'

let cache = Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`

/** Check through stable URLs without sharing mutable paths between readers. */
export let typecheck = async (
  check: Check,
  run: (check: Check, display: (text: string) => string) => Promise<boolean>,
  { root = Deno.cwd(), directory = join(cache, 'yak') } = {},
): Promise<boolean> => {
  await Deno.mkdir(directory, { recursive: true })
  using lock = await Deno.open(join(directory, 'check-types.lock'), {
    create: true,
    write: true,
  })
  await lock.lock(true)
  let alias = join(directory, 'typecheck')
  let anchor = join(directory, 'typecheck-anchor.ts')
  let next = `${alias}.next.${Deno.pid}`
  let members: string[] = []
  try {
    members = await anchors(root)
    await Promise.all(
      members.map((p) => Deno.writeTextFile(join(root, p), 'export {}\n')),
    )
    await Deno.writeTextFile(anchor, 'export {}\n')
    await Deno.symlink(resolve(root), next)
    await Deno.rename(next, alias)
    let [command, ...args] = check.args
    let at = (path: string) => {
      let from = relative(root, resolve(root, path))
      return from.startsWith('../') || isAbsolute(from)
        ? path
        : join(alias, from)
    }
    return await run({
      ...check,
      args: [
        command,
        '--config',
        join(alias, 'deno.json'),
        ...args.filter((a) => a.startsWith('--')),
        anchor,
        ...members.map((p) => join(alias, p)),
        ...args.filter((a) => !a.startsWith('--')).map(at),
      ],
    }, (text) => text.replaceAll(alias, root))
  } finally {
    await Promise.all(
      members.map((p) =>
        Deno.remove(join(root, p)).catch((error) => {
          if (!(error instanceof Deno.errors.NotFound)) throw error
        })
      ),
    )
    await Deno.remove(next).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    })
    await lock.unlock()
  }
}
