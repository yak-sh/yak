#!/usr/bin/python3 -I
# The privileged read for worktree collection. A held process directory ties
# the owner check, cwd and descriptor reads to one process even if its PID is reused.
import json
import os
import re
import sys

def paths(pid, uid):
    fd = os.open("/proc/" + pid, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if os.fstat(fd).st_uid != uid:
            raise ValueError("process belongs to another user")
        cwd = os.readlink("cwd", dir_fd=fd)
        if not cwd.startswith("/"):
            raise ValueError("process directory is not absolute")
        # Like realpath/readlink -e, a deleted cwd refuses collection.
        os.stat(cwd)
        paths = [cwd]
        descriptors = os.open("fd", os.O_RDONLY | os.O_DIRECTORY, dir_fd=fd)
        try:
            for name in os.listdir(descriptors):
                try:
                    path = os.readlink(name, dir_fd=descriptors)
                    if path.startswith("/"):
                        paths.append(path.removesuffix(" (deleted)"))
                except FileNotFoundError:
                    pass
        finally:
            os.close(descriptors)
        return paths
    finally:
        os.close(fd)


try:
    pids = sys.argv[1:]
    if not pids or not all(re.fullmatch(r"[1-9][0-9]*", pid) for pid in pids):
        raise ValueError("expected positive PIDs")
    uid = os.environ.get("SUDO_UID", "")
    if not re.fullmatch(r"[0-9]+", uid):
        raise ValueError("expected the sudo caller's UID")
    uid = int(uid)
    # Keep the single-PID door for already running workers.
    if len(pids) == 1:
        print(json.dumps(paths(pids[0], uid)))
    else:
        found = {}
        for pid in pids:
            try:
                found[pid] = paths(pid, uid)
            except (OSError, ValueError):
                pass
        print(json.dumps(found))
except (OSError, ValueError) as error:
    print("yak-process-cwd: " + str(error), file=sys.stderr)
    sys.exit(1)
