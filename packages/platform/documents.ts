// Which files an app's store reads as documents, by their name and media type:
// each becomes searched rows, one per cited page (./document-graph.ts).
/** The documents read as their text, by extension. A web page is one too: an
 * article a worker fetched and kept is read the way a Word file is. Plain text
 * and Markdown are their own text. */
export let DOCUMENTS: string[] = [
  'pdf',
  'docx',
  'xlsx',
  'xlsm',
  'xlsb',
  'xls',
  'ods',
  'odt',
  'csv',
  'numbers',
  'html',
  'htm',
  'txt',
  'md',
]
let documentName = new RegExp(`\\.(${DOCUMENTS.join('|')})$`, 'i')
export let supported = (name: string, mime: string): boolean =>
  mime == 'application/pdf' || mime.startsWith('text/html') ||
  plain(mime) || documentName.test(name)
// What is read as it is, with no conversion.
export let plain = (mime = ''): boolean =>
  /^text\/(plain|markdown)\b/.test(mime)
export let isPdf = (name: string, mime: string): boolean =>
  mime == 'application/pdf' || /\.pdf$/i.test(name)
