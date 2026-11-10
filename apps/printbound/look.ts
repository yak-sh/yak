/** PrintBound's look as the one stylesheet its pages link: the Spellbound
 * theme, the sheet of each kit part the pages wear, then the skin and the
 * app's own parts over them. The kit's sheets are the platform's own copies,
 * which a `"platform"` dependency on @yaks/ui puts beside the app's files. */

/** The kit's sheets the pages wear, in the order they go: what every theme
 * derives, the document's defaults, the shared surface, then each part. */
export let WORN = [
  'derived',
  'base',
  'Surface',
  'Skip',
  'Button',
  'Field',
  'Form',
  'Notice',
  'Rows',
  'Card',
  'Cards',
  'Empty',
  'Body',
]

/** Every sheet's path among the app's files, in order. */
export let SHEETS = [
  'look/spellbound.css',
  ...WORN.map((name) => `__packages/@yaks/ui/${name}.css`),
  'look/skin.css',
  'look/site.css',
  'look/studio.css',
]

type Files = { fetch(path: string): Promise<Response> }

/** The stylesheet. A sheet that cannot be read fails the whole answer: a
 * page half dressed is worse than one that says so. */
export let look = async (files: Files): Promise<Response> => {
  let sheets = await Promise.all(SHEETS.map(async (path) => {
    let answer = await files.fetch('/' + path)
    if (!answer.ok) throw new Error(`${path}: ${answer.status}`)
    return await answer.text()
  }))
  return new Response(sheets.join('\n'), {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
