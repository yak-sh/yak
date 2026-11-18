// A local tracker's configured checkout becomes capabilities lent to its
// portable effects and tools; neither needs to know the filesystem or Git.
import { sourceFrames, type SourceOptions } from '@yaks/code/source'
import { commitsOf } from '@yaks/git/source'
import type { Options } from '@yaks/host/config'
import { enrichFrames } from '@yaks/tracker'

export let trackerOptions = (
  options: Options,
  sources: typeof sourceFrames = sourceFrames,
  commits: typeof commitsOf = commitsOf,
): Options => {
  let code = options.code as SourceOptions | undefined
  if (!code) return options
  let capabilities = {
    ...code.url && options.enrich == null
      ? { enrich: enrichFrames(sources(code)) }
      : {},
    ...options.commits == null
      ? { commits: (sha: string) => commits(code.cwd, sha) }
      : {},
  }
  return Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(options),
    ...Object.getOwnPropertyDescriptors(capabilities),
  })
}
