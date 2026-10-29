# Bible Study Notes

The app lives in `jeff/bible-study`; the public gallery copy lives at
https://yourname.yaks.app/bible-study/. The files here maintain its passage
worker and gallery illustration. The rest of the app's files are read through
`app_files`.

Passage lookup leaves access control to the platform and the connection's
egress. The demo borrows Jeff's ESV connection, with 100 calls a month, and its
borrowed link allows visitors. Installed copies borrow within the same cap and
can connect their own ESV key. The worker passes only a sentinel to egress and
preserves its cap notice, including the connection instructions.

`demo/seed.json` contains original sample study prompts, without private notes
or published pages. Deploy it as `seed.json` in the demo alone. New installs
from Jeff's published app start with their own empty notebook. Scripture comes
from the ESV API; the app's footer and published pages retain the ESV notice.

The eight Scripture verses in the sample seed are from the ESV® Bible (The Holy
Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of
Good News Publishers. Used by permission. All rights reserved. This Scripture
text remains under Crossway's copyright, separately from the repository's code
license. See https://www.esv.org/.
