/** Isolate workload fixtures from the runner process; only samples cross back. */
let [file, ...args] = Deno.args
let module = await import(new URL('../' + file, import.meta.url).href)
console.log(JSON.stringify(await module.measure(args)))
