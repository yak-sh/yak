// @yaks/api/asset as the shell reads a file a package ships: by its web
// address, as a browser page does. A React Native bundle has no module loader
// to import a file's text or bytes through, and Metro bundles no import of a
// computed address, so metro.config.js gives every file this one instead.

let answered = async (url: URL) => {
  let res = await fetch(url.href)
  if (!res.ok) throw new Error(`${url.href} answered ${res.status}`)
  return res
}

/** The text of the file at `url`. */
export let text = async (url: URL): Promise<string> =>
  await (await answered(url)).text()

/** The bytes of the file at `url`. */
export let bytes = async (url: URL): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await (await answered(url)).arrayBuffer())
