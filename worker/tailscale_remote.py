"""Remote Linux scope protocol. Source is image-owned; arguments carry no keys."""
import base64
import hashlib
import json
import shlex

GUARDIAN = r'''
import base64,hashlib,json,os,pathlib,selectors,signal,socket,stat,subprocess,sys,tempfile,time
p=json.loads(base64.b64decode(sys.argv[1]));home=pathlib.Path.home()
workspace=home
for part in ['.opencode-telegram','ssh-workspaces',p['scope']]:
 workspace=workspace/part
 try:workspace.mkdir(mode=0o700)
 except FileExistsError:pass
 info=workspace.lstat()
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:raise RuntimeError('unsafe remote workspace')
source=base64.b64decode(p['source']);digest=hashlib.sha256(source).hexdigest()
runner=workspace/('scope-'+digest)
if runner.exists():
 info=runner.lstat()
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:raise RuntimeError('unsafe remote runner')
else:
 with tempfile.TemporaryDirectory(dir=workspace) as build:
  location=pathlib.Path(build);(location/'scope.c').write_bytes(source)
  subprocess.run(['cc','-std=c11','-O2','-Wall','-Wextra','-Werror',str(location/'scope.c'),'-o',str(location/'scope')],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
  os.chmod(location/'scope',0o700);os.replace(location/'scope',runner)
cancelled=False
def stop(*_):
 global cancelled
 cancelled=True
signal.signal(signal.SIGHUP,stop);signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
with tempfile.TemporaryDirectory(prefix='ts-remote-') as temporary:
 server=socket.socket(socket.AF_UNIX);server.settimeout(2);address=temporary+'/control';server.bind(address);server.listen(1)
 proc=subprocess.Popen([str(runner),'transient',address,'/bin/sh','-c',p['command']],cwd=workspace,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 control,_=server.accept();server.close();control.setblocking(False)
 selector=selectors.DefaultSelector()
 for stream in (proc.stdout,proc.stderr):
  os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ)
 selector.register(control,selectors.EVENT_READ);selector.register(sys.stdin,selectors.EVENT_READ)
 out=[];err=[];total=0;joined=False;killed=False;deadline=time.monotonic()+20;retire_until=None;receipts=b''
 while not joined or any(key.fileobj in (proc.stdout,proc.stderr) for key in selector.get_map().values()):
  if (cancelled or time.monotonic()>deadline) and not killed:
   try:control.sendall(b'K')
   except OSError:pass
   killed=True;retire_until=time.monotonic()+7
  if retire_until and time.monotonic()>retire_until:raise RuntimeError('remote retirement unconfirmed')
  for key,_ in selector.select(.05):
   if key.fileobj is sys.stdin:
    if not os.read(sys.stdin.fileno(),4096):cancelled=True;selector.unregister(sys.stdin)
   elif key.fileobj is control:
    chunk=control.recv(128)
    if not chunk:
     selector.unregister(control)
     if not joined:raise RuntimeError('remote scope control lost')
    receipts+=chunk
    if b'D' in receipts:joined=True
   else:
    chunk=os.read(key.fileobj.fileno(),65536)
    if not chunk:selector.unregister(key.fileobj);continue
    total+=len(chunk)
    if total>512*1024:cancelled=True
    if total<=512*1024:(out if key.fileobj is proc.stdout else err).append(chunk)
  if proc.poll() is not None and not joined and not retire_until:retire_until=time.monotonic()+1
 code=proc.wait(timeout=1);selector.close();control.close();proc.stdout.close();proc.stderr.close()
 print(json.dumps({'scope':p['scope'],'joined':True,'code':code,'cancelled':killed,'stdout':base64.b64encode(b''.join(out)).decode(),'stderr':base64.b64encode(b''.join(err)).decode()}),flush=True)
'''

def remote_command(identity,target,user,command,source):
    scope=hashlib.sha256(json.dumps([identity['nodeId'],identity['chatId'],identity['threadId'],identity['generation'],target,user],separators=(',',':')).encode()).hexdigest()
    payload=dict(scope=scope,command=command,source=base64.b64encode(source).decode())
    encoded=base64.b64encode(json.dumps(payload,separators=(',',':')).encode()).decode()
    return 'python3 -c '+shlex.quote(GUARDIAN)+' '+shlex.quote(encoded),scope

def remote_result(raw,scope):
    result=json.loads(raw)
    if result.get('scope')!=scope or result.get('joined') is not True or result.get('cancelled') is not False or result.get('code')!=0:
        raise ValueError('remote SSH scope did not complete successfully')
    def decode(field):
        value=result.get(field)
        if not isinstance(value,str) or len(value)>1024*1024:raise ValueError('invalid remote output')
        return base64.b64decode(value,validate=True).decode('utf-8',errors='replace')
    return dict(stdout=decode('stdout'),stderr=decode('stderr'),remoteWorkspace='.opencode-telegram/ssh-workspaces/'+scope)
