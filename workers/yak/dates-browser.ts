import { dates } from './dates.ts'

dates(document)
setInterval(() => dates(document), 60_000)
