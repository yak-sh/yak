import { PAGE } from '@yaks/ui/navigate'
import { dates } from './dates.ts'

dates(document)
setInterval(() => dates(document), 60_000)
// A page brought in place (@yaks/ui/navigate) says its times at once too.
document.addEventListener(PAGE, () => dates(document))
