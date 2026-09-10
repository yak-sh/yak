/** Harness state can move without moving HOME (and Deno's module cache). */
export let home = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_HOME') || `${env('HOME') || '.'}/.harness`

/** The file override wins over the shared state directory. */
export let errorPath = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_ERROR_LOG') || `${home(env)}/exceptions.jsonl`
