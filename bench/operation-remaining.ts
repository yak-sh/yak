/** Independent remaining operation families. The original nineteen-family
 * fixture and baseline remain separate; every listed figure crosses its own
 * production CLI or MCP boundary and checks a populated response or readback. */
import { measureRemaining } from './operation-commands.ts'
import { LOCAL_FAMILIES } from './operation-local.ts'
import { FILE_FAMILIES } from './operation-files.ts'
import { SERVICE_FAMILIES } from './operation-services.ts'
export let REMAINING_FAMILIES = [
  ...LOCAL_FAMILIES,
  ...FILE_FAMILIES,
  ...SERVICE_FAMILIES,
]
export let OPERATION_REMAINING = ['cli', 'connector'].flatMap((door) =>
  REMAINING_FAMILIES.filter((family) =>
    !(door == 'connector' && family == 'code-sync')
  ).map((family) => `${door}/${family}`)
)
export let measure = measureRemaining
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
