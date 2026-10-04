// Browser applications are contributed by configured plugins through ./web.
// The door chooses a contribution; it knows neither that app's state nor views.
import { type Plug, subpath, used } from '@yaks/cli/config'

/** Source assets an application contributes to the browser door. */
export type Application = { entry: URL; mount: URL; styles?: URL }
export type WebFacet = { app: Application }

/** The configured application. A selector resolves multiple contributions. */
export let application = async (
  plugins: Plug[],
  selected?: string,
  load: (plugin: string) => Promise<WebFacet | null> = (p) => subpath(p, 'web'),
): Promise<Application> => {
  let found = (await Promise.all(plugins.map(async (p) => {
    let name = used(p)
    let facet = await load(name)
    return facet?.app ? [{ name, app: facet.app }] : []
  }))).flat()
  let choices = selected ? found.filter((f) => f.name == selected) : found
  if (choices.length != 1) {
    throw new Error(
      `browser door needs one configured ./web application${
        selected ? ` named ${selected}` : ''
      }; found ${choices.length}`,
    )
  }
  return choices[0].app
}
