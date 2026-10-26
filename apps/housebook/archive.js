// A remote document becomes an app upload; source credentials never leave the app.
let answer = (message, status = 422) =>
  Response.json({ error: { message } }, { status })

let source = (value) => {
  try {
    let url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username &&
        !url.password
      ? url
      : null
  } catch {
    return null
  }
}

let document = async (response, url) => {
  let reader = response.body?.getReader(), chunks = [], size = 0
  if (!reader) return null
  while (size < 1024) {
    let { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  let bytes = new Uint8Array(size), offset = 0
  for (let chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  let head = new TextDecoder().decode(bytes.subarray(0, 1024))
  let pdf = head.includes('%PDF-')
  let mime =
    (response.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0].trim().toLowerCase()
  let html = /html/.test(mime) ||
    /^\s*<(?:!doctype\s+html|html|head|body)/i.test(head)
  if (
    !size || html ||
    ((mime === 'application/pdf' || /\.pdf$/i.test(url.pathname)) && !pdf)
  ) {
    await reader.cancel()
    return null
  }
  if (pdf) mime = 'application/pdf'
  let body = new ReadableStream({
    start(controller) {
      for (let chunk of chunks) controller.enqueue(chunk)
    },
    async pull(controller) {
      let { value, done } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  let name = decodeURIComponent(url.pathname.split('/').pop() || 'document')
  if (pdf && !/\.pdf$/i.test(name)) name += '.pdf'
  return { body, mime, name }
}

// What a browser's download asks for. A request naming no encoding is what bot
// screens refuse first: Akamai, in front of appliance makers' manuals
// (whirlpool.com), answers it 403 whatever its user agent, and stalls one
// that names itself a bot.
let asking = {
  accept: 'application/pdf,image/*,*/*;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
  'accept-language': 'en-US,en;q=0.9',
}

export let archive = (download = fetch) => async (req, env) => {
  if (!new URL(req.url).pathname.endsWith('/archive')) {
    return new Response('', { status: 404 })
  }
  if (req.method !== 'POST') return answer('Use Save to keep a document.', 405)
  let me = await env.STORE.fetch('/me')
  if (!me.ok) return me
  if (!(await me.json()).writes) {
    return answer('Sign in to save documents.', 403)
  }
  let value
  try {
    value = await req.json()
  } catch {
    return answer('Enter a document URL.')
  }
  let url = source(value.url)
  if (!url) {
    return answer(
      'Enter an http or https document URL without a username or password.',
    )
  }
  let response
  try {
    response = await download(url.href, {
      headers: asking,
      signal: AbortSignal.timeout(30000),
    })
  } catch (error) {
    return answer(
      `The source could not be reached (${error.message}). Your draft is kept; try again or upload the file.`,
      502,
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    // The person can act on a source's own no (sign-in only, gone, closed to
    // downloads), but it is a site refusing us, not their input: a 502, so
    // the platform reports it with what the site said.
    return answer(
      response.status < 500
        ? `${url.host} refused to send this file (${response.status}). Download it in your browser, then choose the file to upload. Your draft is kept.`
        : `${url.host} answered ${response.status}. Your draft is kept; try again or upload the file.`,
      502,
    )
  }
  let file = await document(response, url)
  if (!file) {
    return answer(
      'This address did not return a document. Paste its direct download URL or upload the file. For an ordinary webpage, choose Website reference. Your draft is kept.',
    )
  }
  return env.STORE.fetch('/blob', {
    method: 'POST',
    headers: {
      'content-type': file.mime,
      'x-yak-name': encodeURIComponent(file.name),
    },
    body: file.body,
  })
}
