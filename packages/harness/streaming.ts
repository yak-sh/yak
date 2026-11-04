/** Resolve host streaming configuration without depending on provider support. */

import * as systemProcess from '@yaks/process/system'
export let streamingEnabled = (
  options: { streaming?: boolean; stream?: boolean },
  env: (name: string) => string | undefined = systemProcess.env.get,
): boolean =>
  options.streaming ?? options.stream ?? env('HARNESS_STREAM') != '0'
