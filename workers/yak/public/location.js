// A framed app reports its own address; its parent cannot read across origins.
;(() => {
  let host = globalThis.parent
  if (!host || host == globalThis) return
  let tell = (origin = '*') =>
    host.postMessage({ 'yak-location': location.href }, origin)
  addEventListener('message', (event) => {
    if (event.source == host && event.data?.['yak-location'] === true) {
      tell(event.origin)
    }
  })
  for (let type of ['pageshow', 'popstate', 'hashchange']) {
    addEventListener(type, () => tell())
  }
  for (let key of ['pushState', 'replaceState']) {
    let move = history[key]
    history[key] = function (...args) {
      let result = Reflect.apply(move, this, args)
      tell()
      return result
    }
  }
  tell()
})()
