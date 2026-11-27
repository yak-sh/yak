// What an app's package.json declares, read without the module graph: a
// host asking which packages an app names (a store composing their words)
// loads none of the compile.

/** A plan that cannot be made, in a sentence the agent can act on. */
export class Unplanned extends Error {
  override name = 'Unplanned'
}

/** The packages package.json declares, name to version range; none without
 * one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(dependencies('{"dependencies": {"three": "^0.180.0"}}'), {
 *   three: '^0.180.0',
 * })
 * assertEquals(dependencies(null), {})
 * ```
 */
export let dependencies = (text: string | null): Record<string, string> => {
  if (text == null) return {}
  let pkg: { dependencies?: unknown }
  try {
    pkg = JSON.parse(text)
  } catch (e) {
    throw new Unplanned(`package.json is not JSON: ${(e as Error).message}`)
  }
  let deps = pkg?.dependencies ?? {}
  if (
    typeof deps != 'object' || deps == null || Array.isArray(deps) ||
    Object.values(deps).some((v) => typeof v != 'string')
  ) {
    throw new Unplanned(
      'package.json: dependencies is an object of package name to version, ' +
        'e.g. {"dependencies": {"three": "^0.180.0"}}',
    )
  }
  return deps as Record<string, string>
}
