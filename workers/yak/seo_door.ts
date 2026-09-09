// What the apex says about itself to a crawler or a model (seo.ts), said as a
// PLUGIN: one root door (plugin.ts `routes`) answering `/robots.txt`,
// `/sitemap.xml`, `/llms.txt` and `/llms-full.txt`, and nothing at all on a
// space's hostname — that hostname is the customer's face and its robots file
// is its own (route.ts).
//
// It is a file of its own, and that is the whole of what this file is for.
// seo.ts reads the guide's page list, and the guide is composed FROM the
// plugin list (guide.ts `PAGES`), so a plugin declared inside seo.ts would
// close a load-time cycle — plugins.ts → seo.ts → guide.ts → plugins.ts —
// whose outcome depends on which module the isolate entered first. The door
// loads seo.ts when it RUNS, after the list is composed, which is how trash.ts
// and meter.ts reach the host modules from a rule.
import type { Plugin } from './plugin.ts'

export let seoPlugin: Plugin = {
  name: 'seo',
  routes: [
    async (at) =>
      at.space == null
        ? await (await import('./seo.ts')).answer(at.path, at.env)
        : null,
  ],
}
