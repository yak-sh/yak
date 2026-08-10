// The two doors this extension speaks, and nothing else. Everything the
// popup and the badge need is a query and a filing — no vocabulary is
// reimplemented here, because both grammars (the `:` line, the url's
// canonical spelling) live in the server and would drift the moment a
// second copy existed.

let FALLBACK = 'http://127.0.0.1:5173'

export let host = async () =>
  (await chrome.storage.sync.get('host')).host || FALLBACK

export let setHost = async (value) => {
  let url = new URL(value)
  // A host outside the manifest's three needs its own grant; asking is
  // only allowed while a click is still on the stack, which is why this
  // runs from the save button and nowhere else.
  await chrome.permissions.request({ origins: [`${url.origin}/*`] })
  await chrome.storage.sync.set({ host: url.origin })
  return url.origin
}

let door = async (path, init) => {
  let res = await fetch(`${await host()}${path}`, init)
  let text = await res.text()
  if (!res.ok) throw new Error(text || `${res.status}`)
  return text ? JSON.parse(text) : null
}

// What already references this page. The address goes over RAW: the
// filter canonicalizes it server-side through the same `url` type the
// saved row went through, so the badge cannot disagree with the save.
// `.web.url` is the explicit spelling — repo.url shares the bare name —
// and the value is QUOTED because '&' separates filters, which every
// address with two query parameters carries.
export let refs = async (url) => {
  let q = encodeURIComponent(`.web.url="${url}"`)
  let hits = await door(`/query?${q}&kind=web&backlinks=1`)
  return hits.flatMap((h) => h.backlinks ?? [])
    // An EDGE backlink is a sentence someone wrote (about, reads); a
    // dotted one is a column (card.target — a card left open on the
    // canvas), which is furniture, not a reference.
    .filter((b) => !b.via.includes('.'))
}

export let file = (filing) =>
  door('/page', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(filing),
  })
