/**
 * A signed-in browser in words a person knows it by: its user-agent read
 * (ua-parser-js) as the browser and the device it runs on, and the place its
 * network says it was (./place.ts).
 *
 * @module
 */
import UAParser from 'ua-parser-js'

// The device a browser runs on, as a person names it: an iPhone or an iPad
// rather than iOS, a Mac rather than macOS, a phone's model where it says one.
let device = (r: UAParser.IResult) => {
  let os = r.os.name ?? ''
  if (os == 'iOS' || os == 'Android') return r.device.model ?? os
  if (os == 'Mac OS') return 'Mac'
  return os
}

let browser = (name: string) =>
  name == 'Chrome Headless'
    ? 'Headless Chrome'
    : name.replace(/^Mobile /, '').replace(/ WebView$/, '')

/**
 * A browser named by what it is and where it runs. An agent no parser knows,
 * a script's or a tool's, is named by its first word.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { browserName } from '@yaks/platform/signed-in'
 * let mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
 *   'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
 * assertEquals(browserName(mac), 'Chrome on Mac')
 * assertEquals(browserName('Deno/2.9.1'), 'Deno')
 * ```
 */
export let browserName = (agent: string): string => {
  let r = new UAParser(agent).getResult()
  let name = r.browser.name ? browser(r.browser.name) : ''
  let on = device(r)
  if (name && on) return `${name} on ${on}`
  return name || on || agent.split(/[\s/]/)[0] || 'A browser'
}

export { placeOf, type Whereabouts } from './place.ts'
