// The media type of a named file. App assets and named uploads use the same
// vocabulary; a caller's specific Content-Type still takes precedence.

let MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
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

export let mimeOf = (name: string): string => {
  let base = name.split('/').pop() ?? ''
  let dot = base.lastIndexOf('.')
  let ext = dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}
