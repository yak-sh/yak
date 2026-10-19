// A failed paint keeps bounded request metadata from the Fetch interception
// already used by the read-only driver. Headers, credentials and query values
// never enter this trail; successful measurements enable no extra CDP domains.
export let requestTrail = () => {
  let requests: { path: string; method: string; allowed: boolean }[] = []
  return {
    reset: () => {
      requests = []
    },
    seen: (request: { url?: string; method: string }, allowed: boolean) => {
      let path = '(unknown URL)'
      try {
        let url = new URL(request.url ?? '')
        path = ['http:', 'https:'].includes(url.protocol)
          ? `${url.protocol}//${url.host}${url.pathname}`.slice(0, 240)
          : `(${url.protocol} resource)`
      } catch { /* an invalid destination is still a recorded attempt */ }
      requests.push({ path, method: request.method.slice(0, 16), allowed })
      if (requests.length > 32) requests.shift()
    },
    snapshot: () => requests.map((r) => ({ ...r })),
  }
}

// Evaluated only after the existing paint patience expires. Performance entries
// describe completed resources, not all outstanding requests; the separate
// intercepted trail says what the page attempted, not what the host answered.
export let failedPage = `JSON.stringify({
  body: document.body?.innerText.slice(0, 2200) ?? '',
  readyState: document.readyState,
  navigation: performance.getEntriesByType('navigation').slice(-1).map(n => ({
    start: n.startTime, responseEnd: n.responseEnd,
    domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd,
    status: n.responseStatus
  })),
  resources: performance.getEntriesByType('resource').slice(-24).map(r => {
    let u = new URL(r.name, location.href);
    return { path: ['http:', 'https:'].includes(u.protocol)
      ? (u.protocol + '//' + u.host + u.pathname).slice(0, 240)
      : '(' + u.protocol + ' resource)',
      kind: r.initiatorType, start: r.startTime, end: r.responseEnd,
      duration: r.duration, status: r.responseStatus };
  })
})`
