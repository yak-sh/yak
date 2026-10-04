#!/usr/bin/python3 -I
# The privileged read for worktree collection. A held process directory ties
# the owner check and cwd read to one process even if its PID is reused.
import os
import re
import sys

try:
    if len(sys.argv) != 2 or not re.fullmatch(r"[1-9][0-9]*", sys.argv[1]):
        raise ValueError("expected one positive PID")
    uid = os.environ.get("SUDO_UID", "")
    if not re.fullmatch(r"[0-9]+", uid):
        raise ValueError("expected the sudo caller's UID")
    fd = os.open("/proc/" + sys.argv[1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if os.fstat(fd).st_uid != int(uid):
            raise ValueError("process belongs to another user")
        cwd = os.readlink("cwd", dir_fd=fd)
        if not cwd.startswith("/"):
            raise ValueError("process directory is not absolute")
        # Like realpath/readlink -e, a deleted cwd refuses collection.
        os.stat(cwd)
        print(cwd)
    finally:
        os.close(fd)
except (OSError, ValueError) as error:
    print("yak-process-cwd: " + str(error), file=sys.stderr)
    sys.exit(1)
