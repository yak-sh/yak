# @yaks/feedback

The feedback tool sends feature requests and bug reports from yak and yaks.app
to the platform's support team. The hosted workflow opens, reads and extends
threads in the platform's support store.

Local yak sends feedback through the yaks.app MCP endpoint. Signed-in requests
use the account selected by `yak auth yaks.app`. Signed-out reports are sent
immediately. Yak supplies its release version and the arguments you enter. Keep
the private receipt from a signed-out submission to read replies or add context
to its thread.

```sh
yak feedback 'Please add a way to export a task with its comments.'
yak feedback --thread '<thread ID or private receipt>'
```
