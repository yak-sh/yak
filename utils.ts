import { createDefine } from 'fresh'

// Shared type of `ctx.state` across middlewares, layouts, and routes. Empty for
// now — the skeleton reads the graph directly in the route.
// deno-lint-ignore no-empty-interface
export interface State {}

export const define = createDefine<State>()
