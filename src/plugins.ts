// The plugin loader — the ONE seam that runs third-party code (D-18663 seam 1,
// M-17881). A plugin is "a module that exports Renderer[] / a comps fragment",
// NOT a framework: importing the module IS loading it, because the module's TOP
// LEVEL calls the existing registrars (extend / defineActions / defineEditors /
// on). There is no manifest, no registry object, no lifecycle here.
//
// INERT UNTIL CONFIGURED: with no specifiers the load is a no-op and every
// surface — server, browser, TUI, CLI — behaves exactly as it does today. This
// is the safety guarantee that lets the loader land while the design is
// reviewed: nothing runs until an operator names a plugin.

// TASKS_PLUGINS names the ES-module specifiers to load, comma- or
// whitespace-separated. It is the ONE config key, read from the environment by
// every long-running surface (server, TUI) and the CLI. The design's first
// choice was a `deno.json` key, but `tasks` there is Deno's reserved task-runner
// field (name → command), so a nested `tasks.plugins` array would corrupt
// `deno task`; the env var is the clean single key. A deno.json door can be
// added later purely inside this function — the loader never learns where its
// specifiers came from. The BROWSER cannot read the environment, so the server
// hands it the browser-servable subset (see server.ts); this reader is for the
// Deno surfaces.
export let pluginSpecifiers = (): string[] => {
  // Resolve relative paths against the CURRENT DIRECTORY, not this module: a
  // bare `import('./plugins/x.ts')` would resolve against plugins.ts (src/),
  // which is never what an operator means. `new URL(spec, cwd)` turns a local
  // path into a file:// URL and passes npm:/jsr:/http:/file: specifiers through
  // untouched (they carry their own scheme).
  let base = `file://${Deno.cwd()}/`
  return (Deno.env.get('TASKS_PLUGINS') ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s, base).href)
}

// Load each specifier by importing it, in order. A plugin registers at its top
// level, so the import IS the effect; load order is the config-list order, which
// is the documented tiebreak when two plugins override the same view
// (registry.ts prepends, ties break by registration order). A failed import is
// the loudest failure (M-16612) — it names the specifier and carries the
// original error as `cause`; the durable plugin-as-entity refusal is T-12785,
// out of scope here. Returns the specifiers it loaded, for callers that assert
// the inert default.
export let loadPlugins = async (specs: string[]): Promise<string[]> => {
  for (let spec of specs) {
    try {
      await import(spec)
    } catch (e) {
      throw new Error(`plugin failed to load: ${spec}`, { cause: e })
    }
  }
  return specs
}
