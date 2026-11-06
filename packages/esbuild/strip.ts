// TypeScript and JSX read as the JavaScript they become, by sucrase: the
// module graph's (./graph.ts `Strip`) wherever a host can carry sucrase. It is
// its own export so a host that cannot afford its bytes (yaks.app's kernel,
// which compiles every module it uploads at each isolate's start) imports the
// graph without it and strips through a host that can.
import { type Transform, transform } from 'sucrase'
import type { Strip } from './graph.ts'

// What each kind of file has stripped. JavaScript is returned as written.
let STRIP: Record<string, Transform[]> = {
  ts: ['typescript'],
  mts: ['typescript'],
  cts: ['typescript'],
  tsx: ['typescript', 'jsx'],
  jsx: ['jsx'],
}

/** A module's source as JavaScript, by what its path says it is. Every
 * import esbuild might keep stays (only `import type` and its kin go), and no
 * syntax the runtime runs is rewritten. Throws a SyntaxError where the source
 * does not parse.
 *
 * ```ts
 * import { assertEquals, assertThrows } from '@std/assert'
 * assertEquals(
 *   strip('a.tsx', "import type { T } from 't'\nimport u from 'u'\n" +
 *     'let n: number = a?.b ?? 1\nlet b = <b />'),
 *   "\nimport u from 'u'\nlet n = a?.b ?? 1\n" +
 *     "let b = React.createElement('b', null )",
 * )
 * assertEquals(strip('a.js', 'let n: = 1'), 'let n: = 1')
 * assertThrows(() => strip('a.ts', 'let n: = 1'), SyntaxError)
 * ```
 */
export let strip: Strip = (path, source) => {
  let transforms = STRIP[path.slice(path.lastIndexOf('.') + 1)]
  if (!transforms) return source
  return transform(source, {
    transforms,
    keepUnusedImports: true,
    disableESTransforms: true,
    production: true,
  }).code
}
