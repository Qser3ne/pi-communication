"""Exercise real Pi terminal mode through two PTYs, without a paid model."""
import os, sys, json, time, pty, subprocess, select, struct, fcntl, termios, socket
from pathlib import Path
agent, cli, extension, node, logdir = sys.argv[1:]
processes = []
steps = []
def pump(delay=0.1):
    end = time.monotonic() + delay
    while time.monotonic() < end:
        ready, _, _ = select.select([p["fd"] for p in processes], [], [], 0.03)
        for fd in ready:
            p = next(p for p in processes if p["fd"] == fd)
            try: data = os.read(fd, 65536)
            except OSError: continue
            p["output"] += data
            if b"\x1b[6n" in data:
                os.write(fd, b"\x1b[1;1R")
def wait(check, label, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pump()
        try:
            value = check()
            if value: return value
        except (FileNotFoundError, json.JSONDecodeError, ConnectionError): pass
    raise AssertionError(label)
def records():
    return [json.loads(p.read_text()) for p in Path(agent, "communication", "sessions").glob("*.json")]
def record(p):
    return next((r for r in records() if r["pid"] == p["child"].pid), None)
def send(p, text):
    os.write(p["fd"], text.encode())
def command(p, text):
    send(p, text + "\r")
    pump(0.3)
def probe(p):
    r = record(p)
    if not r: return {}
    key = json.loads(Path(agent, "communication", "keys", r["instanceId"] + ".json").read_text())["token"]
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(1)
        s.connect(r["endpoint"])
        s.sendall((json.dumps({"kind":"hello","version":1,"token":key,"operation":"probe","to":{k:r[k] for k in ("sessionId","instanceId","name")}})+"\n").encode())
        data = b""
        while b"\n" not in data: data += s.recv(65536)
        return json.loads(data)["view"]
try:
    for name in ("A", "B"):
        cwd = Path(agent, "tui-" + name); cwd.mkdir()
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 120, 0, 0))
        env = {"PATH":os.environ["PATH"],"HOME":agent,"PI_CODING_AGENT_DIR":agent,"PI_OFFLINE":"1","TERM":"xterm-256color"}
        child = subprocess.Popen([node,cli,"--offline","--no-approve","--no-extensions","--no-skills","--no-context-files","--no-themes","--no-prompt-templates","--tui-mode","regular","--provider","fake","--model",name,"--tools","peer_send,peer_reply,bash","-e",extension],cwd=cwd,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
        os.close(slave)
        p = {"child":child,"fd":master,"output":b""}; processes.append(p)
        wait(lambda: record(p), "terminal registered")
        pump(1)
    a, b = processes
    command(a, "/name alpha"); command(b, "/name beta")
    wait(lambda: record(a)["name"] == "alpha" and record(b)["name"] == "beta", "name propagation")
    steps.append("name")
    command(a, "/peers")
    wait(lambda: b"beta" in a["output"] and b"Self:" in a["output"], "peers UI")
    steps.append("peers")
    command(b, "seed"); wait(lambda: probe(b).get("activity") == "idle", "seed settled"); pump(0.5)
    command(a, "START")
    wait(lambda: b"PTY reply" in a["output"] and b"PTY request" in b["output"], "peer rendering and reply")
    wait(lambda: probe(a).get("activity") == "idle" and probe(b).get("activity") == "idle", "peers settle")
    steps.append("source-rendering")
    old = record(b).copy()
    command(b, "/reload")
    wait(lambda: record(b) and record(b)["instanceId"] != old["instanceId"], "reload identity")
    steps.append("reload")
    old = record(b).copy()
    command(b, "/new")
    wait(lambda: record(b) and record(b)["sessionId"] != old["sessionId"], "new identity")
    steps.append("new")
    current = record(b).copy()
    command(b, "/resume"); pump(0.7); send(b, "beta"); pump(0.3); send(b, "\r")
    wait(lambda: record(b) and record(b)["sessionId"] == old["sessionId"] and record(b)["instanceId"] != current["instanceId"], "resume identity")
    steps.append("resume")
    current = record(b).copy()
    command(b, "/fork"); pump(0.6); send(b, "\r")
    wait(lambda: record(b) and record(b)["instanceId"] != current["instanceId"] and record(b)["sessionId"] != current["sessionId"], "fork identity")
    steps.append("fork")
    # Fork restores the selected prompt to the editor. Clear it before next input.
    send(b, "\x15"); command(b, "SLOW")
    wait(lambda: b"sleep 30" in b["output"], "slow tool starts")
    send(b, "\x1b"); pump(0.5)
    wait(lambda: probe(b).get("paused") is True, "Esc pauses intake")
    steps.append("escape")
    command(b, "/peers resume"); wait(lambda: probe(b).get("paused") is False, "resume after Esc")
    command(b, "/peers pause"); wait(lambda: probe(b).get("paused") is True, "manual pause")
    steps.append("pause-resume")
    for p in processes:
        send(p, "\x03"); pump(0.2); send(p, "\x03")
    wait(lambda: all(p["child"].poll() is not None for p in processes), "graceful exit")
    assert not records(), "registration remained after graceful exit"
    steps.append("exit-cleanup")
    print(json.dumps(steps))
finally:
    Path(logdir).mkdir(parents=True,exist_ok=True)
    for index,p in enumerate(processes):
        Path(logdir, "tui-"+str(index)+".log").write_bytes(p["output"])
        if p["child"].poll() is None:
            p["child"].kill()
        p["child"].wait(timeout=5)
        os.close(p["fd"])
