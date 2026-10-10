// Preparing a renderer belongs to the host boundary. Selection keeps the
// complete registration list; preparing replaces implementations without
// changing metadata, ordering, or the caller's registry.
import type {
  Registration,
  Registry,
  RenderContext,
  Renderer,
  Rendering,
} from './types.ts'

export type Prepared<R> = R extends { load: () => Promise<Rendering> }
  ? Omit<R, 'load' | 'render'> & { render: Rendering }
  : R

/** Prepare all renderers, or only the selected registrations a host demanded. */
export function prepared<R extends Registration, A, E>(
  registry: Registry<R, A, E>,
): Promise<Registry<Prepared<R>, A, E>>
export function prepared<R extends Registration, A, E>(
  registry: Registry<R, A, E>,
  requested: readonly R[],
): Promise<Registry<R | Prepared<R>, A, E>>
export async function prepared<R extends Registration, A, E>(
  registry: Registry<R, A, E>,
  requested: readonly R[] = registry.renderers,
): Promise<Registry<R | Prepared<R>, A, E>> {
  let wanted = new Set(requested)
  let renderers = await Promise.all(registry.renderers.map(async (r) => {
    if (!wanted.has(r) || !('load' in r) || typeof r.load != 'function') {
      return r
    }
    let { load, ...metadata } = r
    return { ...metadata, render: await load() } as Prepared<R>
  }))
  return { ...registry, renderers }
}

/** A pure lowering reports deferred selections to its host. Without that
 * boundary, an unprepared renderer is an error, not an empty drawing. */
export let rendering = <Node>(
  renderer: Renderer,
  ctx: RenderContext<Node>,
): Rendering | undefined => {
  if (renderer.render) return renderer.render
  if (!ctx.deferred) {
    throw new Error(`View ${renderer.view} requires preparation`)
  }
  ctx.deferred(renderer)
}
