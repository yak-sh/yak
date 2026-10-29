/** Analytics Engine fixture rows identify the app a grouped query asked for. */
export let rows = (sql: string, day: string) => {
  let value = sql.includes(' AS day')
    ? { day, views: 42 }
    : sql.includes(' AS path')
    ? { path: '/notes/', views: 42 }
    : sql.includes(' AS site')
    ? { site: 'benchmark.invalid', views: 42 }
    : sql.includes(' AS client')
    ? { client: 'browser', views: 42 }
    : { country: 'US', views: 42 }
  let apps = [
    ...sql.matchAll(/'([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})'/gi),
  ]
    .map((match) => match[1])
  return [...new Set(apps)].map((app) => ({ app, ...value }))
}
