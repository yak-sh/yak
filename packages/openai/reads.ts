// Responses accepts these MIME types as input_file, including office files.
// https://developers.openai.com/api/docs/guides/file-inputs
// Files are under 50 MB each and together per request. PDF and images require
// vision; non-PDF documents contribute extracted text or spreadsheet metadata.
// https://developers.openai.com/api/docs/models/o3-mini documents a text-only
// Responses model: it receives those non-PDF inputs without PDF page images.

/** Every non-PDF MIME type in the Responses file-input guide. */
export let FILES: Record<string, number> = Object.fromEntries([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/tsv',
  'text/x-iif',
  'application/x-iif',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.apple.pages',
  'application/vnd.google-apps.document',
  'application/vnd.apple.iwork',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.apple.keynote',
  'application/vnd.google-apps.presentation',
  'application/javascript',
  'application/typescript',
  'text/xml',
  'text/x-shellscript',
  'text/x-rst',
  'text/x-makefile',
  'text/x-lisp',
  'text/x-asm',
  'text/vbscript',
  'text/css',
  'message/rfc822',
  'application/x-sql',
  'application/x-scala',
  'application/x-rust',
  'application/x-powershell',
  'text/x-diff',
  'text/x-patch',
  'application/x-patch',
  'text/plain',
  'text/markdown',
  'text/x-java',
  'text/x-script.python',
  'text/x-python',
  'text/x-c',
  'text/x-c++',
  'text/x-golang',
  'text/html',
  'text/x-php',
  'application/x-php',
  'application/x-httpd-php',
  'application/x-httpd-php-source',
  'text/x-ruby',
  'text/x-sh',
  'text/x-bash',
  'application/x-bash',
  'text/x-zsh',
  'text/x-tex',
  'text/x-csharp',
  'application/json',
  'text/x-typescript',
  'text/javascript',
  'text/x-go',
  'text/x-rust',
  'text/x-scala',
  'text/x-kotlin',
  'text/x-swift',
  'text/x-lua',
  'text/x-r',
  'text/x-R',
  'text/x-julia',
  'text/x-perl',
  'text/x-objectivec',
  'text/x-objectivec++',
  'text/x-erlang',
  'text/x-elixir',
  'text/x-haskell',
  'text/x-clojure',
  'text/x-groovy',
  'text/x-dart',
  'text/x-awk',
  'application/x-awk',
  'text/jsx',
  'text/tsx',
  'text/x-handlebars',
  'text/x-mustache',
  'text/x-ejs',
  'text/x-jinja2',
  'text/x-liquid',
  'text/x-erb',
  'text/x-twig',
  'text/x-pug',
  'text/x-jade',
  'text/x-tmpl',
  'text/x-cmake',
  'text/x-dockerfile',
  'text/x-gradle',
  'text/x-ini',
  'text/x-properties',
  'text/x-protobuf',
  'application/x-protobuf',
  'text/x-sql',
  'text/x-sass',
  'text/x-scss',
  'text/x-less',
  'text/x-hcl',
  'text/x-terraform',
  'application/x-terraform',
  'text/x-toml',
  'application/x-toml',
  'application/graphql',
  'application/x-graphql',
  'text/x-graphql',
  'application/x-ndjson',
  'application/json5',
  'application/x-json5',
  'text/x-yaml',
  'application/toml',
  'application/x-yaml',
  'application/yaml',
  'text/x-astro',
  'text/srt',
  'application/x-subrip',
  'text/x-subrip',
  'text/vtt',
  'text/x-vcard',
  'text/calendar',
].map((type) => [type, 50 * 1024 * 1024 - 1]))

// https://developers.openai.com/api/docs/guides/images-vision
// PNG/JPEG/WebP/non-animated GIF; 512 MB total request payload, including base64.
let references = Object.fromEntries(
  ['image/png', 'image/jpeg', 'image/webp'].map((
    type,
  ) => [type, 14 * 1024 * 1024]),
)

let images = Object.fromEntries(
  ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].map((
    type,
  ) => [type, 384 * 1024 * 1024]),
)

/** Responses file inputs, keeping text-only and specialized endpoints apart. */
export let reads = (name: string): Record<string, number> => {
  if (/^gpt-image-2\.[56](?:-|$)/.test(name)) return references
  let text =
    /^(gpt-(4o|4\.1|5|6)(?:[.-]|$)|o[134](?:-|$)|chatgpt-4o)/.test(name) &&
    !/^(o1-(mini|preview))/.test(name) &&
    !/(audio|transcribe|tts|realtime|search-api)/.test(name)
  let vision =
    /^(gpt-(4o|4\.1|5|6)(?:[.-]|$)|o1(?:-|$)|o3(?:-|$)|o4-mini(?:-|$)|chatgpt-4o)/
      .test(name) &&
    !/^(o1-(mini|preview)|o3-mini)/.test(name) &&
    !/(audio|transcribe|tts|realtime|search-api)/.test(name)
  return !text
    ? {}
    : vision
    ? { ...FILES, ...images, 'application/pdf': 50 * 1024 * 1024 - 1 }
    : FILES
}
