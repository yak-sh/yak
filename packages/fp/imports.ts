// The module-loading boundary. Observers see specifiers before loading, including
// cached modules; with no observer a load only delegates to the runtime.
let listeners = new Set<(specifier: string) => void>()

export let watchImports = (
  listener: (specifier: string) => void,
): () => void => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Notify observers without loading, for a loader's own cache hits. */
export let imported = (dependencies: string[]): void => {
  if (!listeners.size) return
  for (let dependency of dependencies) {
    for (let listener of listeners) listener(dependency)
  }
}

export let importing = (
  specifier: string,
  dependencies: string[] = [specifier],
  // deno-lint-ignore no-explicit-any -- a computed module has no static export shape
): Promise<any> => {
  imported(dependencies)
  return import(specifier)
}
