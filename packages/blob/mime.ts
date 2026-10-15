// The media type of a named file. App assets and named uploads use the same
// vocabulary; a caller's specific Content-Type still takes precedence.

let MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  webmanifest: 'application/manifest+json',
  xml: 'application/xml',
  rss: 'application/rss+xml',
  atom: 'application/atom+xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  zip: 'application/zip',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  mpd: 'application/dash+xml',
}

///
/// mimeOf('dist/_astro/hero.avif') -> 'image/avif'
/// mimeOf('feed.xml') -> 'application/xml'
/// mimeOf('fonts/Inter.ttf') -> 'font/ttf'
/// mimeOf('LICENSE') -> 'application/octet-stream'
export let mimeOf = (name: string): string => {
  let base = name.split('/').pop() ?? ''
  let dot = base.lastIndexOf('.')
  let ext = dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}
