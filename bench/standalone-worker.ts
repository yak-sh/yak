/** Product imports stay warm; measure creates and disposes a fresh fixture. */
import { serve } from './collector.ts'
let [file, ...args] = Deno.args.filter((arg) => arg != '--serve')
let module = await import(new URL('../' + file, import.meta.url).href)
await serve(() => module.measure(args))
