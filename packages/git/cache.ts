// Paths a checkout can regenerate: dependencies, compiler output and declared
// scratch. Every other ignored path can hold unique work.
export let cache = (path: string): boolean =>
  path.split('/').some((part) =>
    ['node_modules', '.scratch', '.types', 'target'].includes(part)
  )
