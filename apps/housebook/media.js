import { el } from './dom.js'
import { safeUrl, title } from './model.js'

export let fileUrl = ({ house_file: file }) =>
  file.blob ? `./api/blob/${file.blob}` : safeUrl(file.url)

export let imageUrl = (row) => {
  let file = row.house_file, url = fileUrl(row)
  if (!url || (!file.blob && !/^https?:/.test(url))) return ''
  if (file.mime) return /^image\//i.test(file.mime) ? url : ''
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(
      new URL(url, 'https://local.invalid').pathname,
    )
    ? url
    : ''
}

export let preview = (row, className, fallback) => {
  let src = row && imageUrl(row)
  return src
    ? el('img', {
      src,
      alt: title(row),
      class: className,
      loading: 'lazy',
      decoding: 'async',
      onError: (event) => event.currentTarget.replaceWith(fallback()),
    })
    : fallback()
}
