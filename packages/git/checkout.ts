// A checkout keeps the commit its first request resolved. Repeating that
// request after its branch moves still means the same checkout.

type Intent = { requested?: unknown; base?: unknown }

export let checkoutBase = async (
  intent: Intent | undefined,
  requested: string | undefined,
  resolve: (name: string) => Promise<string>,
): Promise<string> => {
  let name = String(intent?.requested ?? requested ?? 'HEAD')
  let pinned = intent?.base == null ? undefined : String(intent.base)
  if (intent && requested != null && requested != name) {
    let [before, after] = await Promise.all([
      pinned ?? resolve(name),
      resolve(requested),
    ])
    if (before != after) {
      throw new Error('checkout request conflicts with pinned base intent')
    }
    return before
  }
  return pinned ?? await resolve(name)
}
