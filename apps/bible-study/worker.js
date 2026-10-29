export let passages = (call = fetch) => ({
  async fetch(request, env) {
    const url = new URL(request.url)
    const search = url.pathname.endsWith('/search')
    const explore = url.pathname.endsWith('/explore')
    if (!search && !explore && !url.pathname.endsWith('/passage')) {
      return new Response('Not found', { status: 404 })
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 })
    }

    const query = url.searchParams.get('q')?.trim()
    if (!query || query.length > 200) {
      return Response.json({
        error: search
          ? 'Enter words or a phrase to search.'
          : 'Enter a Bible passage reference.',
      }, { status: 400 })
    }
    if (!env.ESV) {
      return Response.json({
        error: 'The ESV API connection has not been added to this app yet.',
      }, { status: 409 })
    }

    const endpoint = new URL(
      search
        ? 'https://api.esv.org/v3/passage/search/'
        : 'https://api.esv.org/v3/passage/html/',
    )
    endpoint.searchParams.set('q', query)
    if (search) {
      const page = Number(url.searchParams.get('page') || 1)
      if (!Number.isInteger(page) || page < 1 || page > 1000) {
        return Response.json({ error: 'Invalid search page.' }, { status: 400 })
      }
      endpoint.searchParams.set('page-size', '20')
      endpoint.searchParams.set('page', String(page))
    } else {
      endpoint.searchParams.set('include-passage-references', 'false')
      endpoint.searchParams.set('include-verse-numbers', 'true')
      endpoint.searchParams.set('include-first-verse-numbers', 'true')
      endpoint.searchParams.set('include-chapter-numbers', String(explore))
      endpoint.searchParams.set('include-headings', String(explore))
      endpoint.searchParams.set('include-subheadings', String(explore))
      endpoint.searchParams.set('include-footnotes', String(explore))
      endpoint.searchParams.set('include-footnote-body', String(explore))
      endpoint.searchParams.set('include-crossrefs', String(explore))
      endpoint.searchParams.set('include-short-copyright', 'false')
      endpoint.searchParams.set('include-audio-link', 'false')
    }

    let response
    try {
      response = await call(endpoint, {
        headers: { Authorization: `Token ${env.ESV}` },
      })
    } catch {
      return Response.json({ error: 'ESV could not be reached. Try again.' }, {
        status: 502,
      })
    }
    if (!response.ok) {
      const refusal = response.status === 403
        ? await response.clone().text()
        : ''
      if (refusal.startsWith('yaks.app refused this call:')) {
        return Response.json({ error: refusal }, { status: 403 })
      }
      const error = response.status === 401 || response.status === 403
        ? 'ESV rejected the API key. Check the app connection.'
        : response.status === 400 || response.status === 404
        ? 'ESV could not find that passage reference.'
        : 'ESV could not return this passage right now.'
      return Response.json({ error }, {
        status: response.status < 500 ? 400 : 502,
      })
    }
    const data = await response.json()
    if (search) {
      return Response.json({
        results: (data.results || []).map(({ reference, content }) => ({
          reference,
          content,
        })),
        total: data.total_results || 0,
        page: data.page || 1,
        pages: data.total_pages || 1,
      })
    }
    const html = data.passages?.filter(Boolean)
    if (!html?.length) {
      return Response.json({
        error: 'ESV returned no passage for that reference.',
      }, { status: 404 })
    }
    return Response.json({
      reference: data.canonical || query,
      html,
      ...(explore
        ? { meta: data.passage_meta || [], parsed: data.parsed || [] }
        : {}),
    })
  },
})

export default passages()
