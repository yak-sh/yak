// The machine a space's tunnel reaches, as a plugin: one door at an app's own
// address (plugin.ts `answers`), `/api/tunneled/<path>`, which is the app's own
// worker reaching `<path>` on that machine (tunnel.ts `reach`). Not
// `/api/tunnel/`: that is the apex's door for managing the tunnel itself.
//
// A file of its own for seo_door.ts's reason. tunnel.ts reaches the page
// renderer through dispatch.ts, and the renderer reads the vocabulary composed
// from the plugin list (vocab.ts), so a plugin declared inside tunnel.ts would
// close a load-time cycle whose outcome depends on which module the isolate
// entered first. The door loads tunnel.ts when it runs, and only for its own
// paths.
import type { Plugin } from './plugin.ts'

/** Where an app's worker asks for the machine, within its `/api/`. */
export let TUNNELED = '/tunneled/'

export let tunnelPlugin: Plugin = {
  name: 'tunnel',
  answers: [
    async (asked) =>
      asked.path.startsWith(TUNNELED)
        ? await (await import('./tunnel.ts')).reach(asked)
        : null,
  ],
}
