// Document saves keep hosted bytes; only explicit website references remain links.
export let documents = ({ upload, fetch }) => async (props, previous, file) => {
  if (file) {
    let saved = await upload(file)
    return { ...props, blob: saved.eid, mime: saved.mime, reference: false }
  }
  if (props.reference) return { ...props, blob: null, mime: null }
  if (previous?.blob && props.url === (previous.url || '')) return props
  if (!props.url) {
    throw new Error('Choose a file or enter its direct download URL.')
  }
  let response = await fetch('./archive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: props.url }),
  })
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(
      'The document could not be saved. Your draft is kept; sign in again or retry.',
    )
  }
  if (!response.ok) {
    let error = new Error(
      result.error?.message ||
        'The document could not be saved. Your draft is kept.',
    )
    error.status = response.status
    throw error
  }
  return { ...props, blob: result.eid, mime: result.mime, reference: false }
}
