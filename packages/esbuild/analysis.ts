// Bounded analysis results validated against every source read, including
// missing resolution targets. Source identity is deliberately not a cache key.
export let analysisCache = <T>(
  limit: number,
  digest: (value: unknown) => Promise<string>,
) => {
  let entries = new Map<
    string,
    { value: T; reads: string[]; fingerprint: string; bytes: number }
  >()
  let bytes = 0
  return async (
    key: string,
    read: (path: string) => string | null,
    work: (source: { read: typeof read }) => Promise<T>,
  ): Promise<T> => {
    let fingerprint = (paths: string[]) =>
      digest(paths.map((path) => [path, read(path)]))
    let cached = entries.get(key)
    if (cached && cached.fingerprint == await fingerprint(cached.reads)) {
      entries.delete(key)
      entries.set(key, cached)
      return cached.value
    }
    let reads = new Set<string>()
    let value = await work({
      read: (path) => {
        reads.add(path)
        return read(path)
      },
    })
    let paths = [...reads].sort()
    let size = JSON.stringify(value).length * 2 +
      paths.reduce((n, p) => n + p.length * 2, 0)
    // Failed work never replaces a successful entry.
    if (size <= limit) {
      let hash = await fingerprint(paths)
      bytes -= entries.get(key)?.bytes ?? 0
      entries.delete(key)
      while (bytes + size > limit) {
        let oldest = entries.keys().next().value!
        bytes -= entries.get(oldest)!.bytes
        entries.delete(oldest)
      }
      entries.set(key, { value, reads: paths, fingerprint: hash, bytes: size })
      bytes += size
    }
    return value
  }
}
