# Tasks in a conversation

User-created tasks fork the submitting conversation. The original submitted text
is the task body and assignment; no duplicate task is created for the worker.
Model `fork(task)` and `spawn(task)` atomically claim the original task and
record its title/body as the assignment. Delegation remains available when
useful.

User tasks default to an isolated Git worktree. Submission pins the parent's
committed HEAD, records a deterministic child-derived path and branch, and
queues preparation for pool admission. Uncommitted edits are not copied. Outside
a Git repository (or without a committed HEAD), submission fails explicitly
before creating the task. Ordinary model delegation still shares home unless
requested otherwise.

## Snapshot boundary

Idle tasks inherit the current transcript. During an unfinished or interrupted
provider attempt, tasks inherit the prefix before that attempt and record later
user inputs and passive context as child-owned entries. Unfinished provider
output and associated tool activity are excluded, not replayed; an explicit
snapshot notice is included in the child context. Later user input is not
silently dropped. The recorded inputs are written once at admission and are not
recopied on reload. Subsequent parent inputs and output do not enter an already
submitted task.

This is an intentionally bounded snapshot, not a complete copy of ongoing tool
execution: a task requiring results of unfinished parent tools must receive
those results later or be submitted after completion. Midstream snapshot
exclusion needs parent approval before landing as the default policy.
