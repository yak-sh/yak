/** Portable composition pilot. Importing a manifest does not activate services. */
export type Contribution<T = unknown> = {
  /** Stable within this plugin, for diagnostics and configuration. */
  name: string
  /** The receiving subsystem's contract, e.g. vocabulary or commands. */
  target: string
  /** Host capability names, not process placement. */
  requires?: readonly string[]
  load: () => T | Promise<T>
}

export type Manifest = {
  /** Version of this manifest contract, not the package version. */
  api: 1
  id: string
  contributions: readonly Contribution[]
}

/** Hosts supply resolved, pinned specifiers. No discovery or installation. */
export type Installed = { id: string; specifier: string; enabled?: boolean }

export const load = async (
  installed: readonly Installed[],
  resolve: (specifier: string) => Promise<{ default: Manifest }>,
): Promise<Manifest[]> => {
  const seen = new Set<string>()
  for (const item of installed.filter((item) => item.enabled !== false)) {
    if (seen.has(item.id)) throw new Error(`Duplicate plugin: ${item.id}`)
    seen.add(item.id)
  }
  const result: Manifest[] = []
  for (const item of installed) {
    if (item.enabled === false) continue
    const manifest = (await resolve(item.specifier)).default
    if (manifest.api !== 1 || manifest.id !== item.id) {
      throw new Error(`Unsupported or mismatched plugin: ${item.id}`)
    }
    const names = new Set<string>()
    for (const contribution of manifest.contributions) {
      if (names.has(contribution.name)) {
        throw new Error(
          `Duplicate contribution: ${item.id}/${contribution.name}`,
        )
      }
      names.add(contribution.name)
    }
    result.push(manifest)
  }
  return result
}

/** Only selected factories run. Receivers validate payloads against their API. */
export const select = async (
  manifests: readonly Manifest[],
  target: string,
  capabilities: readonly string[] = [],
): Promise<{ plugin: string; name: string; value: unknown }[]> => {
  const chosen = manifests.flatMap((plugin) =>
    plugin.contributions.filter((c) => c.target === target).map((c) => ({
      plugin,
      c,
    }))
  )
  // Check requirements before executing any selected factory.
  for (const { plugin, c } of chosen) {
    for (const requirement of c.requires ?? []) {
      if (!capabilities.includes(requirement)) {
        throw new Error(`${plugin.id}/${c.name} requires ${requirement}`)
      }
    }
  }
  const result = []
  for (const { plugin, c } of chosen) {
    result.push({ plugin: plugin.id, name: c.name, value: await c.load() })
  }
  return result
}
