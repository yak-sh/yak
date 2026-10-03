// The inspector host supplies its page mount and the graph's API prefix.
// Without a declaration, the box serves the inspector at /inspect.
export type Hosting = { page: string; api: string }
export let hosting = (): Hosting =>
  (globalThis as { YAK_INSPECT?: Hosting }).YAK_INSPECT ??
    { page: '/inspect', api: '' }
export let apiPath = (path: string) => hosting().api + path
