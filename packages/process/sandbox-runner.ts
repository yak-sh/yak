// The sandbox's detached supervisor. Its socket, receipts and output live on
// the host, outside the bind mount commands see. Every child remains in this
// supervisor's limited scope; it cannot reach the user manager to escape it.
export let sandboxRunner = String.raw`
import base64, json, os, signal, socketserver, subprocess, sys, threading, time

root = sys.argv[1]
with open(root + '/config.json') as f:
    config = json.load(f)
commands = root + '/commands'
os.makedirs(commands, mode=0o700, exist_ok=True)
lock = threading.RLock()
live = {}

def save(path, data):
    temp = path + '.tmp'
    with open(temp, 'w') as f:
        json.dump(data, f)
    os.replace(temp, path)

def path_for(id):
    if not id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in id):
        raise ValueError('invalid command id')
    return commands + '/' + id

def state(id):
    try:
        with open(path_for(id) + '.json') as f:
            return json.load(f)
    except FileNotFoundError:
        return None

# A supervisor that died cannot safely signal a recorded PID: it may have
# been reused. A scope is stopped before replacement, and old receipts end
# with unknown status, never a second launch of the same durable call.
for name in os.listdir(commands):
    if name.endswith('.json'):
        path = commands + '/' + name
        with open(path) as f:
            old = json.load(f)
        if 'exit' not in old:
            old['exit'] = {'code': None}
            save(path, old)

with open('/proc/self/cgroup') as f:
    group = next(line.strip()[3:] for line in f if line.startswith('0::'))
cgroup = '/sys/fs/cgroup' + group
with open(cgroup + '/cpu.max') as f:
    quota, period = f.read().split()
with open(cgroup + '/memory.max') as f:
    memory = f.read().strip()
with open(cgroup + '/pids.max') as f:
    tasks = f.read().strip()
limits = config['limits']
if (quota == 'max' or int(quota) / int(period) > limits['cpuQuota'] / 100 + 0.00001
        or memory == 'max' or int(memory) > limits['memoryMax']
        or tasks == 'max' or int(tasks) > limits['tasksMax']):
    raise RuntimeError('sandbox scope did not apply its CPU, memory and task limits')

def argv(args, cwd='/workspace', env=None):
    result = list(config['bwrap'])
    for key, value in (env or {}).items():
        result += ['--setenv', key, value]
    return result + ['--chdir', cwd, '--'] + args

# Fail before lending a machine if namespaces or the read-only system cannot
# actually execute. Never fall back to an unrestricted host command.
subprocess.run(argv(['/bin/bash', '-c', 'true']), check=True)

# One pre-existing reaper and one sequential control server keep look/kill
# available even when guest forks fill TasksMax. No per-request thread is
# needed to recover from task pressure.
def reap():
    while True:
        with lock:
            for id, child in list(live.items()):
                code = child.poll()
                if code is not None:
                    value = state(id)
                    value['exit'] = {'code': code if code >= 0 else 128 - code}
                    save(path_for(id) + '.json', value)
                    live.pop(id, None)
        time.sleep(0.025)

threading.Thread(target=reap, daemon=True).start()

def run_file(args, data=None):
    result = subprocess.run(argv(['/usr/bin/python3', '-c'] + args), input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace'))
    return result.stdout

def handle(request):
    op = request['op']
    if op == 'hello':
        return {'cgroup': cgroup, 'cpu': [quota, period], 'memory': memory, 'tasks': tasks}
    if op == 'start':
        id = request['id']
        with lock:
            prior = state(id)
            if prior is not None:
                return prior
            # The receipt precedes the external act; an ambiguous receipt is
            # inspectable, but must never cause a durable call to run twice.
            value = {}
            save(path_for(id) + '.json', value)
            try:
                with open(path_for(id) + '.out', 'ab') as output:
                    child = subprocess.Popen(argv(['/bin/bash', '-c', request['command']],
                        request['cwd'], request['env']), stdin=subprocess.DEVNULL,
                        stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                value['pid'] = child.pid
                save(path_for(id) + '.json', value)
                live[id] = child
            except Exception:
                value['exit'] = {'code': None}
                save(path_for(id) + '.json', value)
                raise
            return value
    if op == 'look':
        with lock:
            return state(request['id'])
    if op == 'tail':
        try:
            with open(path_for(request['id']) + '.out', 'rb') as f:
                # Scan backwards: a long-running agent's whole log is not a
                # request's memory footprint. Keep arbitrarily wide lines.
                blocks = []
                end = f.seek(0, 2)
                lines = 0
                while end and lines <= request['n']:
                    size = min(end, 65536)
                    end -= size
                    f.seek(end)
                    block = f.read(size)
                    blocks.append(block)
                    lines += block.count(b'\n')
                return b''.join(reversed(blocks)).decode(errors='replace').splitlines()[-request['n']:]
        except FileNotFoundError:
            return []
    if op == 'kill':
        with lock:
            child = live.get(request['id'])
            if child is not None and child.poll() is None:
                try:
                    os.killpg(child.pid, getattr(signal, request['signal']))
                except ProcessLookupError:
                    pass
        return None
    if op in ('read', 'export'):
        code = 'import sys; sys.stdout.buffer.write(open(sys.argv[1], "rb").read())'
        if op == 'export':
            code = ('import os,sys; p=os.path.realpath(sys.argv[1]); '
                    'assert p.startswith("/workspace/"), "export escapes workspace"; '
                    'sys.stdout.buffer.write(open(p, "rb").read())')
        return base64.b64encode(run_file([
            code, request['path']])).decode()
    if op == 'write':
        run_file(['import os,sys; p=sys.argv[1]; os.makedirs(os.path.dirname(p),exist_ok=True); '
                  'open(p,"wb").write(sys.stdin.buffer.read())', request['path']],
                 base64.b64decode(request['bytes']))
        return None
    raise ValueError('unknown sandbox operation')

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            response = {'value': handle(json.loads(self.rfile.readline()))}
        except Exception as e:
            response = {'error': str(e)}
        self.wfile.write((json.dumps(response) + '\n').encode())

class Server(socketserver.UnixStreamServer):
    pass

sock = root + '/control.sock'
try:
    os.unlink(sock)
except FileNotFoundError:
    pass
with Server(sock, Handler) as server:
    os.chmod(sock, 0o600)
    server.serve_forever()
`
