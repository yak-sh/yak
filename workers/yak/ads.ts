// The ad networks yaks.app tells of what their clicks brought (conversions.ts):
// today Meta alone (meta-ads.ts).
import type { Env } from './env.ts'
import { type Conversion, conversionOf, type Told } from './arrival.ts'
import { type Network, tell } from './conversions.ts'
import { background } from './defects.ts'
import { meta } from './meta-ads.ts'

export let NETWORKS: Network[] = [meta]

/** Tell the networks one conversion, as yak-front hands it over (index.ts
 * `Ads`). */
export let told = (env: Env, c: Conversion) => tell(env, c, NETWORKS)

/** Tell of a step this request took, after its answer, when an ad's click
 * brought it. */
export let after = (env: Env, step: Told, req: Request) => {
  let c = conversionOf(step, req)
  if (c) background(told(env, c))
}
