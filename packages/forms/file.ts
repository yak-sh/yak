/** Sends a file to its question's app; resolves to its blob reference or refusal. */
export type Upload = (
  at: string,
  question: string,
  file: File,
) => Promise<{ eid: string } | string>

/** The blob door alongside the form, including another app's absolute door. */
export let blobAt = (
  at: string,
  question: string,
  base: string | undefined = globalThis.document?.baseURI ||
    globalThis.location?.href,
): string => {
  let url = new URL(at, base)
  let form = decodeURIComponent(url.pathname.split('/').pop()!)
  url.pathname = url.pathname.replace(/\/form\/[^/]+$/, '/blob')
  url.search = new URLSearchParams({ form, question }).toString()
  url.hash = ''
  return url.href
}

/** The default upload: the chosen file's bytes to the form app's blob door. */
export let upload = async (
  at: string,
  question: string,
  file: File,
  request: typeof fetch = fetch,
): Promise<{ eid: string } | string> => {
  try {
    let r = await request(blobAt(at, question), {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-yak-name': encodeURIComponent(file.name),
      },
      body: file,
    })
    if (r.ok) {
      let result = await r.json() as { eid: string }
      return { eid: result.eid }
    }
    let text = (await r.text()).trim()
    try {
      return JSON.parse(text).message || text
    } catch {
      return text || 'That file did not upload. Try again.'
    }
  } catch {
    return 'That file did not upload. Check the connection and try again.'
  }
}
