// Compiler wall-clock phases, measured in its native runtime rather than the
// host Worker's I/O-only clock. Callbacks carry only fixed names and numbers,
// never source text, package names or credentials.
export type Phase =
  | 'install'
  | 'worker'
  | 'carried'
  | 'used'
  | 'groups'
  | 'cache'
  | 'pages'
  | 'total'
export type Timing = Record<Phase, number> & {
  /** Shared-group cache lookups, counted rather than milliseconds. */
  hits: number
  misses: number
}
export type Report = (phase: Phase | 'hits' | 'misses', value: number) => void

/** Start a phase only when someone is listening; finish it even on failure. */
export let phase = (report: Report | undefined, name: Phase) => {
  let at = report ? performance.now() : 0
  let finished = false
  return () => {
    if (report && !finished) report(name, performance.now() - at)
    finished = true
  }
}

/** Fixed metric names keep compiler diagnostics distinct from host stages. */
export let header = (timing: Timing) =>
  Object.entries(timing).filter(([name]) => name != 'hits' && name != 'misses')
    .map(([name, ms]) => `compiler_${name};dur=${ms.toFixed(3)}`).join(', ')
