// A fixed, read-only door to the published demo's current recipes. No caller
// URL, credentials, personal store or write is accepted by this proxy.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/demo-recipes')) {
      if (request.method !== 'GET') {
        return new Response('Read only', { status: 405 })
      }
      try {
        const source = new URL('https://yourname.yaks.app/recipes/api/query')
        source.search = '.recipe&?doc&.limit=30'
        const response = await fetch(source, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
        })
        if (!response.ok) throw new Error('Demo source unavailable')
        const rows = await response.json()
        if (!Array.isArray(rows)) throw new Error('Invalid demo source')
        return Response.json(
          rows.filter((r) => r.recipe && r.doc).map((r) => ({
            entity: { eid: r.entity.eid },
            doc: { title: r.doc.title },
            recipe: {
              category: r.recipe.category,
              duration: r.recipe.duration,
              serves: r.recipe.serves,
              ingredients: r.recipe.ingredients,
              steps: r.recipe.steps,
            },
          })),
          { headers: { 'cache-control': 'public, max-age=30' } },
        )
      } catch {
        return Response.json({
          error:
            'The demo recipe box is taking a moment. Open the original or try again.',
        }, { status: 503 })
      }
    }
    return env.FILES.fetch(request)
  },
}
