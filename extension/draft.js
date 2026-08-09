// The popup is disposable, but its unfinished line is not. localStorage is
// synchronous so closing the popup immediately after a keystroke cannot race
// an asynchronous extension-storage write.

let key = (url) => `line:${url}`

export let recall = (storage, url) => storage.getItem(key(url)) ?? ''

export let remember = (storage, url, line) => {
  if (line) storage.setItem(key(url), line)
  else storage.removeItem(key(url))
}

// A filing response may arrive after the next line has begun. Only the bytes
// sent by that request belong to it; later typing must remain in both places.
export let filed = (storage, url, sent, current) => {
  if (current != sent) return current
  remember(storage, url, '')
  return ''
}
