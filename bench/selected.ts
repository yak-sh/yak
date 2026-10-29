/** A paired group runs only the metrics sharing its historical reference. */
let names = Deno.env.get('BENCH_NAMES')
let wanted = names ? new Set<string>(JSON.parse(names)) : undefined
let filter = Deno.env.get('BENCH_FILTER')
let pattern = filter ? new RegExp(filter) : undefined

export let selected = (name: string): boolean =>
  (!wanted || wanted.has(name)) && (!pattern || pattern.test(name))
