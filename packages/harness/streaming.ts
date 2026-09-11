/** Resolve host streaming configuration without depending on provider support. */
export let streamingEnabled = (
  options: { streaming?: boolean; stream?: boolean },
  env: (name: string) => string | undefined = Deno.env.get,
): boolean =>
  options.streaming ?? options.stream ?? env('HARNESS_STREAM') != '0'
