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

## Fork boundary

Tasks reference a parent entry through `fork.from`, just like ordinary forks.
They inherit the contiguous prefix through that entry; context is not copied
into new child entries. The child receives its fork note and task assignment.

Without an active provider attempt, the boundary is the latest parent entry.
During an active attempt, it is the entry immediately before the first in-flight
ask. This excludes the mutable output and any later messages. Submit another
instruction to the child if it needs those later messages. Interrupted and
completed attempts are terminal and do not hold future forks at an old boundary.
Their already-recorded history remains available; no historical entries are
rewritten or removed by this change.
