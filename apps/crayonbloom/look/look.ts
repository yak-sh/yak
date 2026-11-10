/** CrayonBloom's look, composed as the one stylesheet its pages link: the
 * crayon theme, then each kit part the pages wear with the skin's sheet
 * laid over it, then the app's own parts. The kit's sheets are the ones a
 * declared `@yaks/ui` dependency ships beside the worker
 * (`__packages/@yaks/ui/`); `read` says where a path's text comes from, so
 * the worker reads its files and a test its checkout. */

/** The kit's parts these pages wear, the document's defaults first. */
export let WORN = [
  'base',
  'Surface',
  'Skip',
  'Button',
  'Card',
  'Cards',
  'Field',
  'Form',
  'Check',
  'Chip',
  'Chips',
  'Dot',
  'State',
  'Body',
  'Notice',
  'Empty',
]

/** The parts the skin lays a sheet of its own over (look/skin). */
export let SKIN = [
  'base',
  'Surface',
  'Button',
  'Card',
  'Cards',
  'Field',
  'Form',
  'Check',
  'Chip',
  'Body',
  'Notice',
  'Empty',
]

/** The app's own parts (look/parts). */
export let OWN = [
  'Mast',
  'Foot',
  'Band',
  'Lead',
  'Kicker',
  'Squig',
  'Hero',
  'Doodles',
  'Wave',
  'Spark',
  'Steps',
  'Sheet',
  'Ticks',
  'Desk',
  'Tray',
]

let KIT = '__packages/@yaks/ui/'

/** Every sheet's path, in the order a browser reads them. */
export let sheets = (): string[] => [
  'look/crayon.css',
  KIT + 'derived.css',
  ...WORN.flatMap((name) => [
    `${KIT}${name}.css`,
    ...(SKIN.includes(name) ? [`look/skin/${name}.css`] : []),
  ]),
  ...OWN.map((name) => `look/parts/${name}.css`),
]

/** The stylesheet, each sheet read through `read`. */
export let stylesheet = async (
  read: (path: string) => Promise<string>,
): Promise<string> => (await Promise.all(sheets().map(read))).join('\n')
