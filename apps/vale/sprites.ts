// Item pictures in the page: ask a browser worker for each design once,
// then fill every picture of that kind when its completed PNG arrives.
import { ITEMS, type Thing } from './items.ts'
import { paint, spriteSize } from './sprite-paint.ts'
import { painted } from './sprite-thread.ts'
export { faces } from './sprite-paint.ts'

type Drawing = { item: Thing; url?: string }
let drawn = new Map<string, Drawing>()
let workerFailed = false
let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let show = (kind: string, url?: string) => {
  for (
    let img of document.querySelectorAll<HTMLImageElement>(
      'img.Sprite[data-sprite]',
    )
  ) {
    if (img.dataset.sprite != kind) continue
    if (url) img.src = url
    else img.removeAttribute('src')
  }
}

// A worker or OffscreenCanvas can be unavailable on a browser; keep the
// picture, and report the failure so it can be fixed.
let onPage = (item: Thing): Promise<Blob> =>
  new Promise((done, fail) => {
    let canvas = document.createElement('canvas')
    canvas.width = canvas.height = spriteSize
    let g = canvas.getContext('2d')
    if (!g) return fail(new Error('No 2D canvas for an item picture'))
    paint(item, g)
    canvas.toBlob((blob) =>
      blob ? done(blob) : fail(new Error('Item picture could not be encoded'))
    )
  })

let start = (kind: string, item: Thing): Drawing => {
  let had = drawn.get(kind)
  if (had?.item == item) return had
  let entry: Drawing = { item, url: had?.url }
  drawn.set(kind, entry)
  let drawing = workerFailed ? onPage(item) : painted(item).catch((error) => {
    if (!workerFailed) reportError(error)
    workerFailed = true
    return onPage(item)
  })
  void drawing.then((blob) => {
    if (drawn.get(kind) != entry) return
    let url = URL.createObjectURL(blob)
    entry.url = url
    show(kind, url)
    if (had?.url) URL.revokeObjectURL(had.url)
  }).catch((error) => {
    if (drawn.get(kind) == entry) drawn.delete(kind)
    reportError(error)
  })
  return entry
}

/** Refresh pictures already requested when store designs change. */
export let refreshSprites = () => {
  for (let kind of drawn.keys()) {
    let item = ITEMS[kind]
    if (item?.look.length) start(kind, item)
    else {
      let had = drawn.get(kind)
      drawn.delete(kind)
      show(kind)
      if (had?.url) URL.revokeObjectURL(had.url)
    }
  }
}

/** A completed picture URL, or an empty string while its worker paints. */
export let sprite = (kind: string): string => {
  let item = ITEMS[kind]
  return item?.look.length ? start(kind, item).url ?? '' : ''
}

/** A kind's picture as HTML, sized by the text around it (ui/Sprite.css). */
export let icon = (kind: string): string => {
  if (!ITEMS[kind]?.look.length) return ''
  let url = sprite(kind)
  return `<img class=Sprite data-sprite="${esc(kind)}"${
    url ? ` src="${esc(url)}"` : ''
  } alt="">`
}
