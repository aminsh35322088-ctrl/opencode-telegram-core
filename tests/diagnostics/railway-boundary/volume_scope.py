# Unshipped validation loader: persistent atomic append exposes live old writers.
import json,os,signal,subprocess,sys,threading,time
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,'/validation/boundary')
import scope_boundary as s
path=Path('/containment-test/epochs.jsonl')
namespace=os.readlink('/proc/self/ns/pid')
def append(kind):
    fd=os.open(path,os.O_APPEND|os.O_CREAT|os.O_WRONLY,0o600)
    try: os.write(fd,(json.dumps({'kind':kind,'boot':s.p.BOOT,'namespace':namespace,'time':time.time_ns()})+'\n').encode());os.fsync(fd)
    finally:os.close(fd)
append('start')
# Persist only the final live Core fixture, leaving finite retirement checks isolated.
state_root=Path('/containment-test/core-state');state_root.mkdir(exist_ok=True)
saved_path=Path('/containment-test/paused-owner.json')
original_configure=s.p.configure
persistent=False
def configure(root,env):
 original_configure(root,env)
 if persistent:
  for key,name in [('HOME','home'),('XDG_DATA_HOME','data'),('XDG_CONFIG_HOME','config'),('XDG_STATE_HOME','state'),('XDG_CACHE_HOME','cache')]:
   directory=state_root/name;directory.mkdir(exist_ok=True);env[key]=str(directory)
s.p.configure=configure
if saved_path.exists():
 saved=json.loads(saved_path.read_text());persistent=True
 with s.p.Server(s.p.BINARY,readiness_path='/global/health',configure=configure) as runtime:
  client=s.p.Client(runtime.base);sid=saved['session'];old=saved['execution']
  recovered=client.request('GET',f'/session/{sid}/execution')
  assert recovered=={'runId':old['runId'],'paused':True,'continuation':'unavailable'},recovered
  try:client.request('POST',f'/session/{sid}/resume',{'runId':old['runId']})
  except Exception as error:assert '409' in str(error),str(error)
  else:raise AssertionError('lost continuation resumed')
  assert client.request('POST',f'/session/{sid}/abort',{'runId':old['runId']}) is True
  assert client.request('GET',f'/session/{sid}/execution') is None
  s.EVIDENCE['recoveredPause']={'priorBoot':saved['boot'],'session':sid,'recovered':recovered,'staleResumeRejected':True,'explicitAbortClearedIntent':True}
 persistent=False
original_paused_server=s.p.paused_server
pause_calls=0
def paused_server():
 global pause_calls,persistent
 pause_calls+=1;persistent=pause_calls==2
 runtime,captured=original_paused_server()
 if persistent:
  client=s.p.Client(runtime.base)
  paused=[]
  for item in client.request('GET','/session'):
   execution=client.request('GET',f"/session/{item['id']}/execution")
   if execution and execution['paused'] and execution['continuation']=='live':paused.append((item['id'],execution))
  assert len(paused)==1,paused
  raw=json.dumps({'boot':s.p.BOOT,'session':paused[0][0],'execution':paused[0][1]})
  temporary=saved_path.with_suffix('.new');temporary.write_text(raw)
  with temporary.open('r') as handle:os.fsync(handle.fileno())
  os.replace(temporary,saved_path)
  fd=os.open(saved_path.parent,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 return runtime,captured
s.p.paused_server=paused_server
s.EVIDENCE['volume']={'path':str(path),'namespace':namespace,'mounts':[line for line in Path('/proc/self/mountinfo').read_text().splitlines() if '/containment-test' in line]}
# Independent bounded double-fork writer; no wrapper/runtime cleanup can remove it.
child='''import json,os,time,urllib.request
os.setsid()
if os.fork():os._exit(0)
'''+f'path={str(path)!r};boot={s.p.BOOT!r};namespace={namespace!r};url={s.p.WITNESS!r};token={s.p.TOKEN!r};end=time.monotonic()+300\n'+'''
while time.monotonic()<end:
 event={'kind':'volumeHeartbeat','boot':boot,'namespace':namespace,'time':time.time_ns(),'pid':os.getpid()}
 fd=os.open(path,os.O_APPEND|os.O_CREAT|os.O_WRONLY,0o600)
 os.write(fd,(json.dumps({'kind':'write',**{k:v for k,v in event.items() if k!='kind'}})+'\\n').encode());os.fsync(fd);os.close(fd)
 try:urllib.request.urlopen(urllib.request.Request(url,data=json.dumps(event).encode(),headers={'content-type':'application/json','authorization':token}),timeout=2).close()
 except Exception:pass
 time.sleep(.25)
'''
compile(child,'volume-writer','exec')
writer_error=open('/tmp/volume-writer-'+s.p.BOOT+'.stderr','w')
launcher=subprocess.Popen([sys.executable,'-c',child],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=writer_error);launcher.wait(timeout=5)
s.p.wait_for(lambda:any(record.get('boot')==s.p.BOOT and record.get('kind')=='write' for record in map(json.loads,path.read_text().splitlines())),seconds=5)
s.p.emit('volumeWriterReady',namespace=namespace)
class HTTP(s.HTTP):
 def do_GET(self):
  if self.path=='/volume' and self.headers.get('authorization')==s.p.TOKEN:
   records=[json.loads(line) for line in path.read_text().splitlines()]
   raw=json.dumps({'records':records,'boot':s.p.BOOT,'namespace':namespace}).encode();self.send_response(200);self.end_headers();self.wfile.write(raw)
  else:super().do_GET()
threading.Thread(target=s.cases,daemon=True).start()
ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','3000'))),HTTP).serve_forever()
