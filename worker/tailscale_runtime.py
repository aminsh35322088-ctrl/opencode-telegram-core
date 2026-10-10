"""Root execution adapter. Core holds governor admission and captured tool authority.

The private admission token arrives in Core through an inherited descriptor. Only
Core's compiled adapter can start scopes; the model bridge has no token or keys.
"""
import hmac
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UP = ['up','--timeout=20s','--accept-dns=false','--accept-routes=false','--shields-up','--ssh=false','--advertise-tags=tag:opencode-bot']

CAPABILITIES = {'connect':'device.enroll','status':'network.status','devices':'network.devices',
                'ssh':'ssh.exec','disconnect':'network.status','logout':'device.enroll'}

def eligible_devices(status):
    devices=[]
    for peer in status.get('Peer', {}).values():
        if peer.get('Online') is not True or 'tag:ssh' not in peer.get('Tags',[]): continue
        addresses=[]
        for value in peer.get('TailscaleIPs',[]):
            try:
                ip=ipaddress.ip_address(value)
                if ip in ipaddress.ip_network('100.64.0.0/10') or ip in ipaddress.ip_network('fd7a:115c:a1e0::/48'):addresses.append(str(ip))
            except ValueError: pass
        identifier=peer.get('ID')
        if addresses and isinstance(identifier,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}',identifier):
            devices.append(dict(id=identifier,name=str(peer.get('DNSName','')).rstrip('.')[:256],address=addresses[0]))
    return sorted(devices,key=lambda item:item['id'])

class ScopeStartupError(RuntimeError):
    pass

class Scope:
    """Existing Linux subreaper runner; D receipt required before releasing admission."""
    def __init__(self, runner, command, cwd, pass_fds=(), quiet=False, home=None, keepalive=False):
        self.directory=tempfile.TemporaryDirectory(prefix='ts-scope-')
        self.proc=None;self.control=None;self.empty=False;self.lock=threading.Lock()
        os.chmod(self.directory.name,0o700)
        server=socket.socket(socket.AF_UNIX);server.settimeout(2)
        try:
            address=self.directory.name+'/control';server.bind(address);server.listen(1)
            self.proc=subprocess.Popen([runner,'transient',address,*command],cwd=cwd,
                env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':str(home or cwd),'XDG_CONFIG_HOME':str(Path(home or cwd)/'.config'),'LANG':'C.UTF-8'},
                stdin=subprocess.PIPE if keepalive else subprocess.DEVNULL,stdout=subprocess.DEVNULL if quiet else subprocess.PIPE,stderr=subprocess.DEVNULL if quiet else subprocess.PIPE,
                pass_fds=pass_fds,start_new_session=True)
            self.control,_=server.accept();self.control.settimeout(7)
        except BaseException:
            # A startup exception must never abandon the runner. Without an
            # accepted control channel there is no D receipt: kill/reap the
            # runner as best effort, then retire Worker rather than claim join.
            unconfirmed=self.proc is not None
            if self.control is not None:
                try:self.retire();unconfirmed=False
                except Exception:pass
            if self.proc is not None and not self.empty:
                if self.control:self.control.close()
                if self.proc.poll() is None:
                    try:os.killpg(self.proc.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                try:self.proc.wait(timeout=1)
                except Exception:pass
                finally:
                    for stream in (self.proc.stdin,self.proc.stdout,self.proc.stderr):
                        if stream:stream.close()
            self.directory.cleanup()
            if unconfirmed:raise ScopeStartupError('Tailscale bootstrap join unconfirmed') from None
            raise
        finally:server.close()
    @property
    def pid(self):return self.proc.pid
    def retire(self):
        with self.lock:
            if self.empty:return
            if self.proc.stdin:self.proc.stdin.close()
            try:self.control.sendall(b'K')
            except (BrokenPipeError,ConnectionResetError):pass
            until=time.monotonic()+7
            while time.monotonic()<until:
                data=self.control.recv(128)
                if b'D' in data:
                    self.proc.wait(timeout=1);self.empty=True;self.control.close()
                    for stream in (self.proc.stdout,self.proc.stderr):
                        if stream:stream.close()
                    self.directory.cleanup();return
                if not data:break
            raise RuntimeError('Tailscale scope retirement unconfirmed')
    def output(self, cancelled, timeout=30, limit=1024*1024):
        selector=selectors.DefaultSelector()
        chunks=[];size=0;deadline=time.monotonic()+timeout
        for stream in (self.proc.stdout,self.proc.stderr):
            os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ)
        try:
            while selector.get_map():
                if cancelled.is_set() or time.monotonic()>=deadline:raise ValueError('Tailscale operation cancelled or timed out')
                for key,_ in selector.select(.05):
                    if cancelled.is_set():raise ValueError('Tailscale operation cancelled')
                    data=os.read(key.fileobj.fileno(),65536)
                    if not data:selector.unregister(key.fileobj);continue
                    size+=len(data)
                    if size>limit:raise ValueError('Tailscale output exceeded bound')
                    if key.fileobj is self.proc.stdout:chunks.append(data)
            code=self.proc.wait(timeout=max(.1,deadline-time.monotonic()))
            if code!=0:raise ValueError('Tailscale command failed')
            return b''.join(chunks).decode('utf-8',errors='replace')
        finally:selector.close()

class TailscaleRuntime:
    def __init__(self,agent,port=4101,runner='/usr/local/libexec/opencode-process-scope',
                 cli='/usr/local/bin/tailscale',daemon='/usr/local/bin/tailscaled',now=time.time,scope_source='/opt/worker/process-scope.c'):
        self.agent,self.port,self.runner,self.cli,self.daemon,self.now=agent,port,runner,cli,daemon,now
        self.scope_source=Path(scope_source)
        self.root=agent.boundary.root.parent/'tailscale'
        if self.root.is_symlink():raise ValueError('Tailscale state must not be a symlink')
        self.root.mkdir(mode=0o700,parents=True,exist_ok=True)
        info=self.root.stat()
        if info.st_uid!=os.getuid():raise ValueError('Tailscale state owner mismatch')
        os.chmod(self.root,0o700)
        for entry in self.root.iterdir():
            if entry.is_symlink() or entry.stat().st_uid!=os.getuid():raise ValueError('unsafe Tailscale state')
        self.lock=threading.RLock();self.operation=None;self.token=None;self.server=None;self.core_epoch=0;self.retirement_failed=False
    def reference(self):
        refs=[ref for ref in (self.agent.boundary.snapshot or {}).get('credentialReferences',[])
              if isinstance(ref,dict) and ref.get('integrationId')=='tailscale' and ref.get('configured') is True]
        if len(refs)!=1 or not isinstance(refs[0].get('credentialId'),str):raise ValueError('Tailscale credential unavailable')
        return refs[0]['credentialId']
    def owner(self):return self.agent.credentials._owner()
    def authorize(self,capability,resource=None):
        identity,session=self.owner()
        payload=dict(integrationId='tailscale',credentialId=self.reference(),capability=capability,scopes=[capability],
            workerId=identity['nodeId'],topicId=str(identity['chatId'])+':'+str(identity['threadId']),generation=identity['generation'],sessionId=session)
        if resource is not None:payload['resource']=resource
        reply=self.agent.outbound('capability.authorize',payload,session=session)
        expires=reply.get('expiresAt') if isinstance(reply,dict) else None
        if (self.owner()!=(identity,session) or reply.get('authorized') is not True or type(expires) not in (float,int)
            or not math.isfinite(expires) or not self.now()*1000<expires<=(self.now()+60)*1000):raise ValueError('Tailscale capability rejected')
        return identity,session
    def start(self):
        if self.server:return
        runtime=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_POST(self):
                try:
                    self.connection.settimeout(10)
                    size=int(self.headers.get('Content-Length','0'))
                    if not 0<size<=65536 or self.headers.get('Transfer-Encoding'):raise ValueError()
                    token=self.headers.get('x-core-admission','')
                    with runtime.lock:
                        if not runtime.token or not hmac.compare_digest(token,runtime.token):raise ValueError()
                        admission=(runtime.core_epoch,runtime.token)
                    value=json.loads(self.rfile.read(size))
                    with runtime.lock:runtime.check_admission(admission)
                    if self.path=='/execute':
                        self.send_response(200);self.send_header('Connection','close');self.end_headers()
                        def send(message):
                            self.wfile.write(json.dumps(message).encode()+b'\n');self.wfile.flush()
                        try:
                            result=runtime.dispatch(self.path,value,lambda pid:send({'pid':pid}),admission=admission)
                            send({'ok':True,'result':result})
                        except Exception:
                            try:send({'ok':False})
                            except OSError:pass
                        return
                    result=runtime.dispatch(self.path,value,admission=admission)
                    body=json.dumps({'ok':True,'result':result}).encode();code=200
                except Exception:body=b'{"ok":false,"error":"Tailscale operation rejected"}';code=409
                self.send_response(code);self.send_header('Connection','close');self.send_header('Content-Length',str(len(body)));self.end_headers()
                try:self.wfile.write(body)
                except OSError:pass
        self.server=ThreadingHTTPServer(('127.0.0.1',self.port),Handler)
        self.port=self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
    def core_descriptor(self):
        with self.lock:
            self.close_active();self.start();self.core_epoch+=1;self.token=secrets.token_hex(32)
            descriptor={'token':self.token,'endpoint':'http://127.0.0.1:'+str(self.port)}
        fd,writer=os.pipe()
        try:os.write(writer,json.dumps(descriptor).encode())
        finally:os.close(writer)
        return fd
    def retire_core(self):
        with self.lock:
            self.core_epoch+=1;self.token=None
            self.close_active()
    def close_active(self):
        with self.lock:
            op=self.operation
            if not op:return
            op['cancel'].set()
            lease=op.get('enrollment')
            if lease is not None:
                lease.discard();threading.Thread(target=lease.release,daemon=True).start()
            try:
                for scope in reversed(op['scopes']):scope.retire()
            except Exception:
                self.retirement_failed=True
                self.operation=None
                if hasattr(self.agent,'fatal_core_exit'):self.agent.fatal_core_exit()
                raise
            self.operation=None
    def check_admission(self,admission):
        if self.retirement_failed:raise RuntimeError('Tailscale Worker retirement required')
        if admission is not None and (not self.token or admission!=(self.core_epoch,self.token)):raise ValueError('Core admission retired')
    def dispatch(self,path,value,on_pid=None,admission=None):
        if not isinstance(value,dict):raise ValueError()
        if path=='/stop':
            with self.lock:
                self.check_admission(admission)
                if self.operation and value.get('id')!=self.operation['id']:raise ValueError()
                self.close_active();return {'joined':True}
        if path=='/start':
            with self.lock:
                self.check_admission(admission)
                if self.operation:raise ValueError('Tailscale operation already active')
                action=value.get('action');capability=CAPABILITIES.get(action)
                if not capability or set(value)-{'id','action','sessionId','directory','target','user','command'}:raise ValueError()
                owner=self.authorize(capability,value.get('target') if action=='ssh' else None)
                if value.get('sessionId')!=owner[1] or Path(value.get('directory','')).resolve()!=self.agent.workspace.resolve():raise ValueError()
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',value.get('id','')):raise ValueError()
                if action=='ssh' and (not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',value.get('target','')) or
                    not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}',value.get('user','')) or not isinstance(value.get('command'),str)
                    or not 0<len(value['command'])<=8192 or '\x00' in value['command'] or value['command'].lstrip().startswith('-')):raise ValueError()
                if self.owner()!=owner:raise ValueError('Tailscale owner replaced')
                scope=self.spawn_scope([self.daemon,'--tun=userspace-networking','--state='+str(self.root/'state'),
                    '--socket='+str(self.root/'socket')],str(self.root),quiet=True)
                self.operation=dict(id=value['id'],request=value,owner=owner,scopes=[scope],cancel=threading.Event())
                return {'pid':scope.pid}
        with self.lock:
            self.check_admission(admission)
            op=self.operation
            if not op or value.get('id')!=op['id'] or self.owner()!=op['owner']:raise ValueError()
        if path=='/execute':
            with self.lock:
                self.check_admission(admission)
                if self.operation is not op or op['cancel'].is_set():raise ValueError()
                if op.get('executing'):raise ValueError('duplicate Tailscale command')
                op['executing']=True;op['on_pid']=on_pid
            return self.execute(op)
        raise ValueError()
    def spawn_scope(self,command,cwd,pass_fds=(),**options):
        try:return Scope(self.runner,command,cwd,pass_fds,**options)
        except ScopeStartupError:
            self.retirement_failed=True
            if hasattr(self.agent,'fatal_core_exit'):self.agent.fatal_core_exit()
            raise
    def command(self,op,args,auth=None):
        if op['cancel'].is_set() or self.owner()!=op['owner']:raise ValueError()
        if op['scopes'][0].proc.poll() is not None:raise ValueError('Tailscale daemon crashed')
        fd=None
        try:
            if auth is not None:
                if not auth.startswith('tskey-auth-'):raise ValueError('enrollment key required')
                fd=os.memfd_create('tailscale-enroll',flags=0);os.write(fd,auth.encode());os.lseek(fd,0,0)
                args=[*args,'--auth-key=file:/proc/self/fd/'+str(fd)]
            scope=self.spawn_scope([self.cli,'--socket='+str(self.root/'socket'),*args],str(self.agent.workspace),() if fd is None else (fd,),home=self.root,keepalive=args[0]=='ssh')
            with self.lock:
                if op['cancel'].is_set():scope.retire();raise ValueError()
                op['scopes'].append(scope)
            try:
                if op.get('on_pid'):op['on_pid'](scope.pid)
                return scope.output(op['cancel'],timeout=30)
            finally:scope.retire()
        finally:
            if fd is not None:os.close(fd)
    def execute(self,op):
        request=op['request'];action=request['action'];capability=CAPABILITIES[action]
        def fence():
            while not op['cancel'].wait(2):
                checked=threading.Event();accepted=[]
                def validate():
                    try:
                        self.authorize(capability,request.get('target') if action=='ssh' else None)
                        if self.owner()!=op['owner']:raise ValueError('Tailscale owner replaced')
                        lease=op.get('enrollment')
                        if lease is not None:lease.consume(lambda _:None)
                        accepted.append(True)
                    except Exception:pass
                    finally:checked.set()
                threading.Thread(target=validate,daemon=True).start()
                # A blocked signed CP request must not keep privileged work
                # running until its ordinary 30-second HTTP timeout.
                if not checked.wait(2) or not accepted:
                    with self.lock:
                        if self.operation is op:self.close_active()
                    return
        threading.Thread(target=fence,daemon=True,name='tailscale-operation-fence').start()
        self.authorize(capability,request.get('target') if action=='ssh' else None)
        if op['cancel'].is_set():raise ValueError('Tailscale operation retired')
        deadline=time.monotonic()+3
        while not (self.root/'socket').exists():
            if op['cancel'].wait(.02) or time.monotonic()>deadline or op['scopes'][0].proc.poll() is not None:raise ValueError('Tailscale startup failed')
        if action=='connect':
            status=json.loads(self.command(op,['status','--json']))
            if status.get('BackendState') in ('Running','Stopped') and status.get('Self',{}).get('ID'):
                self.command(op,UP)
            else:
                with self.agent.credentials.acquire(dict(integrationId='tailscale',credentialId=self.reference(),capability='device.enroll',scopes=['device.enroll'])) as lease:
                    op['enrollment']=lease
                    try:lease.consume(lambda auth:self.command(op,UP,auth))
                    finally:op.pop('enrollment',None)
        elif action in ('devices','ssh'):
            self.command(op,UP)
        elif action in ('disconnect','logout'):
            self.command(op,['down' if action=='disconnect' else 'logout'])
            self.authorize(capability);return {'nodeState':'disconnected' if action=='disconnect' else 'logged-out','runtimeState':'stopped','connectionMode':'on-demand','connected':False}
        status=json.loads(self.command(op,['status','--json']))
        if action=='devices':result={'devices':eligible_devices(status)}
        elif action=='ssh':
            peers=[peer for peer in eligible_devices(status) if peer['id']==request['target']]
            if len(peers)!=1:raise ValueError('SSH peer not eligible')
            self.authorize(capability,request['target'])
            # Options precede the remote command; no user-selected public host or SSH proxy.
            from tailscale_remote import remote_command,remote_result
            source_info=self.scope_source.lstat()
            if not self.scope_source.is_file() or self.scope_source.is_symlink() or source_info.st_uid!=os.getuid() or source_info.st_mode&0o022 or source_info.st_size>32768:
                raise ValueError('immutable remote scope source unavailable')
            command,scope=remote_command(op['owner'][0],request['target'],request['user'],request['command'],self.scope_source.read_bytes())
            result=remote_result(self.command(op,['ssh',request['user']+'@'+peers[0]['address'],
                '-oBatchMode=yes','-oConnectTimeout=10','-oConnectionAttempts=1',command]),scope)
        else:result={'nodeState':str(status.get('BackendState','Unknown')),'enrolled':bool(status.get('Self',{}).get('ID'))}
        self.authorize(capability,request.get('target') if action=='ssh' else None)
        if self.owner()!=op['owner'] or op['cancel'].is_set():raise ValueError()
        return {**result,'runtimeState':'stopped','connectionMode':'on-demand','connected':False}
