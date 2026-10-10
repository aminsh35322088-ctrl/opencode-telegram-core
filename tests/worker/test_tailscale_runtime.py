import json, os, sys, tempfile, unittest, subprocess, threading, time
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from credential_broker import CredentialBroker
try:
    from tailscale_runtime import TailscaleRuntime, eligible_devices, Scope
except ImportError:
    TailscaleRuntime = eligible_devices = None

class TailscaleTests(unittest.TestCase):
    def test_devices_only_online_tagged_and_safe_address(self):
        self.assertIsNotNone(eligible_devices, 'Tailscale runtime missing')
        peers = {'Peer': {'a':dict(ID='n1', DNSName='one.tail.', Online=True, Tags=['tag:ssh'], TailscaleIPs=['100.80.1.1']),
                          'b':dict(ID='n2', Online=False, Tags=['tag:ssh'], TailscaleIPs=['100.80.1.2']),
                          'c':dict(ID='n3', Online=True, Tags=[], TailscaleIPs=['100.80.1.3']),
                          'd':dict(ID='n4', Online=True, Tags=['tag:ssh'], TailscaleIPs=['8.8.8.8'])}}
        self.assertEqual(eligible_devices(peers), [dict(id='n1', name='one.tail', address='100.80.1.1')])

    def test_protected_identity_rejects_symlink_and_bad_owner(self):
        self.assertIsNotNone(TailscaleRuntime, 'Tailscale runtime missing')
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            agent = SimpleNamespace(boundary=SimpleNamespace(root=root/'agent'))
            (root/'agent').mkdir()
            (root/'tailscale').symlink_to(root/'agent', target_is_directory=True)
            with self.assertRaises(ValueError): TailscaleRuntime(agent)

    def test_authorization_bound_to_exact_owner_and_expiry(self):
        self.assertIsNotNone(TailscaleRuntime, 'Tailscale runtime missing')
        with tempfile.TemporaryDirectory() as d:
            identity=dict(nodeId='worker',generation=3,chatId=-100,threadId=42)
            boundary=SimpleNamespace(root=Path(d)/'agent', identity=identity, unbound=False,
                snapshot={'credentialReferences':[dict(integrationId='tailscale',credentialId='ts',configured=True)]},get=lambda _: 'session')
            calls=[]
            agent=SimpleNamespace(boundary=boundary,ready=True,retired=False,workspace=Path(d)/'topic')
            def outbound(op, payload, session=None):
                calls.append((op,payload,session)); return {'authorized':True,'expiresAt':110000}
            agent.outbound=outbound
            agent.credentials=CredentialBroker(agent,now=lambda:100)
            runtime=TailscaleRuntime(agent,now=lambda:100)
            runtime.authorize('network.devices')
            self.assertEqual(calls[-1][1]['workerId'],'worker')
            self.assertEqual(calls[-1][1]['topicId'],'-100:42')
            self.assertEqual(calls[-1][1]['scopes'],['network.devices'])
            def replace(*args,**kwargs):
                identity['generation']=4; return {'authorized':True,'expiresAt':110000}
            agent.outbound=replace
            with self.assertRaises(ValueError):runtime.authorize('network.devices')


    def test_delayed_authenticated_body_cannot_cross_core_descriptor_rotation(self):
        import socket
        from unittest.mock import patch
        import tailscale_runtime as module
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'agent').mkdir();(root/'topic').mkdir()
            identity=dict(nodeId='worker',generation=3,chatId=-100,threadId=42)
            boundary=SimpleNamespace(root=root/'agent',identity=identity,unbound=False,
                snapshot={'credentialReferences':[dict(integrationId='tailscale',credentialId='ts',configured=True)]},get=lambda _:'session')
            agent=SimpleNamespace(boundary=boundary,ready=True,retired=False,workspace=root/'topic',
                outbound=lambda *a,**kw:dict(authorized=True,expiresAt=(time.time()+40)*1000))
            agent.credentials=CredentialBroker(agent)
            runtime=TailscaleRuntime(agent,port=0)
            fd=runtime.core_descriptor();os.close(fd)
            original_compare=module.hmac.compare_digest
            for path in ('/start','/execute','/stop'):
                with self.subTest(path=path):
                    authenticated=threading.Event()
                    def compare(a,b):
                        result=original_compare(a,b);authenticated.set();return result
                    value=dict(id='operation',action='status',sessionId='session',directory=str(root/'topic')) if path=='/start' else dict(id='operation')
                    body=json.dumps(value).encode()
                    client=socket.create_connection(('127.0.0.1',runtime.port));client.settimeout(2)
                    try:
                        with patch.object(module.hmac,'compare_digest',side_effect=compare):
                            client.sendall(('POST '+path+' HTTP/1.1\r\nHost: localhost\r\nx-core-admission: '+runtime.token+'\r\nContent-Length: '+str(len(body))+'\r\n\r\n').encode()+body[:1])
                            self.assertTrue(authenticated.wait(1))
                            runtime.retire_core();fd=runtime.core_descriptor();os.close(fd)
                            scope=SimpleNamespace(retire=lambda:None)
                            fresh=dict(id='operation',request=value,owner=runtime.owner(),scopes=[scope],cancel=threading.Event())
                            if path!='/start':runtime.operation=fresh
                            with patch.object(module,'Scope') as create, patch.object(runtime,'execute',return_value={}) as execute:
                                client.sendall(body[1:]);reply=client.recv(4096)
                                self.assertIn(b'409',reply)
                                create.assert_not_called();execute.assert_not_called()
                                if path!='/start':self.assertIs(runtime.operation,fresh)
                    finally:client.close();runtime.close_active()
            runtime.retire_core();runtime.server.shutdown();runtime.server.server_close()

    def test_failed_scope_bootstrap_reaps_runner_and_never_reports_joined(self):
        from unittest.mock import patch
        import tailscale_runtime as module
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'agent').mkdir();(root/'topic').mkdir()
            runner=root/'broken-runner';runner.write_text('#!/bin/sh\nexec sleep 20\n');runner.chmod(0o700)
            identity=dict(nodeId='worker',generation=3,chatId=-100,threadId=42)
            boundary=SimpleNamespace(root=root/'agent',identity=identity,unbound=False,
                snapshot={'credentialReferences':[dict(integrationId='tailscale',credentialId='ts',configured=True)]},get=lambda _:'session')
            fatal=[]
            agent=SimpleNamespace(boundary=boundary,ready=True,retired=False,workspace=root/'topic',
                fatal_core_exit=lambda:fatal.append(True),outbound=lambda *a,**kw:dict(authorized=True,expiresAt=(time.time()+40)*1000))
            agent.credentials=CredentialBroker(agent)
            runtime=TailscaleRuntime(agent,runner=str(runner))
            processes=[];original_popen=module.subprocess.Popen
            def popen(*args,**kwargs):
                process=original_popen(*args,**kwargs);processes.append(process);return process
            try:
                with patch.object(module.subprocess,'Popen',side_effect=popen):
                    with self.assertRaises(Exception):runtime.dispatch('/start',dict(id='operation',action='status',sessionId='session',directory=str(root/'topic')))
                self.assertTrue(processes)
                self.assertIsNotNone(processes[0].poll(),'startup failure left a live runner')
                self.assertEqual(fatal,[True],'unproven bootstrap must retire Worker')
                with self.assertRaises(Exception):runtime.dispatch('/stop',dict(id='operation'))
            finally:
                for process in processes:
                    if process.poll() is None:os.killpg(process.pid,9);process.wait(timeout=2)

    def test_blocked_periodic_authorization_retires_operation_independently(self):
        from unittest.mock import patch
        import tailscale_runtime as module
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'agent').mkdir();(root/'topic').mkdir()
            identity=dict(nodeId='worker',generation=3,chatId=-100,threadId=42)
            boundary=SimpleNamespace(root=root/'agent',identity=identity,unbound=False,
                snapshot={'credentialReferences':[dict(integrationId='tailscale',credentialId='ts',configured=True)]},get=lambda _:'session')
            blocked,release=threading.Event(),threading.Event();calls=[];joined=[]
            def outbound(*args,**kwargs):
                calls.append(True)
                if len(calls)>1:blocked.set();release.wait(7)
                return dict(authorized=True,expiresAt=(time.time()+40)*1000)
            agent=SimpleNamespace(boundary=boundary,ready=True,retired=False,workspace=root/'topic',outbound=outbound)
            agent.credentials=CredentialBroker(agent)
            runtime=TailscaleRuntime(agent);(runtime.root/'socket').touch()
            scope=SimpleNamespace(proc=SimpleNamespace(poll=lambda:None),retire=lambda:joined.append(True))
            op=dict(id='op',request=dict(action='status'),owner=runtime.owner(),scopes=[scope],cancel=threading.Event())
            runtime.operation=op;errors=[]
            def command(*_):
                op['cancel'].wait(6)
                raise ValueError('cancelled')
            def execute():
                try:runtime.execute(op)
                except Exception as error:errors.append(error)
            with patch.object(runtime,'command',side_effect=command):
                thread=threading.Thread(target=execute);thread.start()
                try:
                    self.assertTrue(blocked.wait(3));self.assertTrue(op['cancel'].wait(3),'CP timeout kept operation alive')
                    thread.join(.5);self.assertFalse(thread.is_alive());self.assertTrue(errors)
                    self.assertTrue(joined);self.assertIsNone(runtime.operation)
                finally:release.set();thread.join(1)

    def test_real_scopes_connect_preserve_identity_and_ssh_eligible_peer(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'agent').mkdir();(root/'topic').mkdir()
            runner=root/'scope'
            subprocess.run(['cc','-std=c11','-O2',str(Path(__file__).parents[2]/'runtime/linux/process-scope.c'),'-o',str(runner)],check=True)
            daemon=root/'daemon';daemon.write_text("#!/usr/bin/python3\nimport socket,sys,time\ns=socket.socket(socket.AF_UNIX);s.bind([a.split('=',1)[1] for a in sys.argv if a.startswith('--socket=')][0]);s.listen();time.sleep(120)\n");daemon.chmod(0o700)
            cli=root/'cli';cli.write_text("""#!/usr/bin/python3
import sys,json,pathlib
sock=pathlib.Path(sys.argv[1].split('=',1)[1]);state=sock.parent/'state'
a=sys.argv[2:]
if a[0]=='up':
 for item in a:
  if item.startswith('--auth-key='):
   key=pathlib.Path(item.split('file:',1)[1]).read_text()
   assert key=='tskey-auth-fixture-private'
   state.write_text('persistent-node-identity')
   if (sock.parent/'enroll-wait').exists():
    import os,time
    (sock.parent/'enroll.pid').write_text(str(os.getpid()))
    time.sleep(10)
elif a[0]=='status':print(json.dumps({'BackendState':'Running' if state.exists() else 'NeedsLogin','Self':{'ID':'self'} if state.exists() else {},'Peer':{'one':{'ID':'peer','Online':True,'Tags':['tag:ssh'],'TailscaleIPs':['100.80.1.1'],'DNSName':'peer.tail.'}}}))
elif a[0]=='ssh':
 import subprocess
 assert a[1]=='user@100.80.1.1'
 subprocess.run(['/bin/sh','-c',a[-1]],check=True)
""");cli.chmod(0o700)
            identity=dict(nodeId='worker',generation=3,chatId=-100,threadId=42)
            boundary=SimpleNamespace(root=root/'agent',identity=identity,unbound=False,snapshot={'credentialReferences':[dict(integrationId='tailscale',credentialId='ts',configured=True)]},get=lambda _:'session')
            calls=[]
            revoked=[False]
            credential_valid=[True]
            def outbound(op,payload,session=None):
                calls.append((op,payload))
                if op=='credential.acquire':return dict(value='tskey-auth-fixture-private',leaseId='lease',expiresAt=110000)
                if op=='credential.validate':return dict(valid=credential_valid[0])
                return dict(authorized=not revoked[0],expiresAt=110000)
            agent=SimpleNamespace(boundary=boundary,ready=True,retired=False,workspace=root/'topic',outbound=outbound)
            agent.credentials=CredentialBroker(agent,now=lambda:100)
            runtime=TailscaleRuntime(agent,runner=str(runner),cli=str(cli),daemon=str(daemon),now=lambda:100,scope_source=Path(__file__).parents[2]/'runtime/linux/process-scope.c')
            def invoke(action,**kwargs):
                request=dict(id='operation',action=action,sessionId='session',directory=str(root/'topic'),**kwargs)
                pid=runtime.dispatch('/start',request)['pid'];self.assertGreater(pid,0)
                def audit(pid):
                    for field in ('cmdline','environ'):
                        self.assertNotIn(b'tskey-auth-fixture-private',Path('/proc/'+str(pid)+'/'+field).read_bytes())
                try:return runtime.dispatch('/execute',{'id':'operation'},audit)
                finally:
                    self.assertEqual(runtime.dispatch('/stop',{'id':'operation'}),{'joined':True})
                    with self.assertRaises(ProcessLookupError):os.kill(pid,0)
                    # tailscaled owns its socket; an actual restart removes stale socket.
                    (runtime.root/'socket').unlink(missing_ok=True)
            connected=invoke('connect')
            self.assertTrue(connected['enrolled']);self.assertFalse(connected['connected']);self.assertEqual(connected['runtimeState'],'stopped')
            self.assertEqual((runtime.root/'state').read_text(),'persistent-node-identity')
            self.assertEqual(invoke('ssh',target='peer',user='user',command='printf remote-command-result')['stdout'].strip(),'remote-command-result')
            self.assertEqual(sum(op=='credential.acquire' for op,_ in calls),1)
            with self.assertRaises(ValueError):invoke('ssh',target='not-eligible',user='user',command='pwd')
            self.assertEqual(stat_mode(runtime.root),0o700)
            request=dict(id='cancelled',action='ssh',sessionId='session',directory=str(root/'topic'),target='peer',user='user',command="setsid sh -c 'echo $$ > descendant.pid; sleep 120' & wait")
            runtime.dispatch('/start',request)
            failures=[]
            def execute():
                try:runtime.dispatch('/execute',{'id':'cancelled'})
                except Exception as error:failures.append(error)
            thread=threading.Thread(target=execute);thread.start()
            deadline=time.monotonic()+3
            from tailscale_remote import remote_command
            _,remote_scope=remote_command(identity,'peer','user',request['command'],(Path(__file__).parents[2]/'runtime/linux/process-scope.c').read_bytes())
            marker=runtime.root/'.opencode-telegram/ssh-workspaces'/remote_scope/'descendant.pid'
            while not marker.exists():
                self.assertLess(time.monotonic(),deadline);time.sleep(.01)
            child=int(marker.read_text())
            runtime.dispatch('/stop',{'id':'cancelled'});thread.join(timeout=2)
            self.assertFalse(thread.is_alive());self.assertTrue(failures)
            deadline=time.monotonic()+8
            while Path('/proc/'+str(child)).exists():
                self.assertLess(time.monotonic(),deadline);time.sleep(.02)
            (runtime.root/'socket').unlink(missing_ok=True)
            # Revocation while a remote command runs retires its local and detached trees.
            marker.unlink()
            runtime.dispatch('/start',{**request,'id':'revoked'})
            errors=[]
            def revoked_execute():
                try:runtime.dispatch('/execute',{'id':'revoked'})
                except Exception as error:errors.append(error)
            worker=threading.Thread(target=revoked_execute);worker.start()
            deadline=time.monotonic()+4
            while not marker.exists():self.assertLess(time.monotonic(),deadline);time.sleep(.02)
            revoked[0]=True
            worker.join(timeout=5)
            self.assertFalse(worker.is_alive());self.assertTrue(errors)
            with runtime.lock:self.assertIsNone(runtime.operation)
            child=int(marker.read_text())
            with self.assertRaises(ProcessLookupError):os.kill(child,0)
            revoked[0]=False
            (runtime.root/'socket').unlink(missing_ok=True)
            # A lease revoked while its enrollment command awaits readiness is cancelled.
            (runtime.root/'state').unlink();(runtime.root/'enroll-wait').touch()
            runtime.dispatch('/start',dict(id='enrollment',action='connect',sessionId='session',directory=str(root/'topic')))
            enrollment_errors=[]
            def enroll():
                try:runtime.dispatch('/execute',{'id':'enrollment'})
                except Exception as error:enrollment_errors.append(error)
            enrolling=threading.Thread(target=enroll);enrolling.start()
            deadline=time.monotonic()+4
            while not (runtime.root/'enroll.pid').exists():self.assertLess(time.monotonic(),deadline);time.sleep(.02)
            enroll_pid=int((runtime.root/'enroll.pid').read_text())
            for field in ('cmdline','environ'):
                self.assertNotIn(b'tskey-auth-fixture-private',Path('/proc/'+str(enroll_pid)+'/'+field).read_bytes())
            credential_valid[0]=False
            enrolling.join(timeout=5);self.assertFalse(enrolling.is_alive());self.assertTrue(enrollment_errors)
            with runtime.lock:self.assertIsNone(runtime.operation)
            with self.assertRaises(ProcessLookupError):os.kill(enroll_pid,0)
            credential_valid[0]=True
            (runtime.root/'socket').unlink(missing_ok=True)
            # A real inherited descriptor delivers only to Core, not tool env.
            source=Path(__file__).parents[2]/'.work/opencode/packages/core/src'
            bun=Path('/home/agent/.bun/bin/bun')
            if source.exists() and bun.exists():
                runtime.port=0
                fd=runtime.core_descriptor()
                runtime.port=runtime.server.server_address[1]
                probe=root/'probe.ts'
                probe.write_text('''
import {createToolProcessScope} from "SOURCE/telegram-tool-process"
import {SessionExecutionControl} from "SOURCE/session-execution-control"
import {telegramProcessBudgetSnapshot} from "SOURCE/telegram-process-budget"
const directory=process.cwd()
const execution=new SessionExecutionControl().start({sessionId:"session",runId:"run",directory})
const scope=createToolProcessScope(execution,execution.epoch,"session",directory,new AbortController().signal)
const result=await scope.port.network({action:"status"})
await scope.close()
if(process.env.CORE_DELEGATED_FD!==undefined)throw new Error("descriptor exposed")
console.log(JSON.stringify({result,budget:telegramProcessBudgetSnapshot()}))
'''.replace('SOURCE',str(source)))
                try:
                    native=subprocess.run([str(bun),str(probe)],cwd=root/'topic',env=dict(os.environ,CORE_DELEGATED_FD=str(fd),OPENCODE_TELEGRAM_PROCESS_BUDGET='1'),pass_fds=(fd,),capture_output=True,text=True,timeout=20)
                finally:os.close(fd);runtime.server.shutdown();runtime.server.server_close()
                self.assertEqual(native.returncode,0,native.stderr)
                self.assertNotIn(runtime.token,native.stdout+native.stderr)
                parsed=json.loads(native.stdout);self.assertEqual(parsed['result']['nodeState'],'Running')
                self.assertEqual(parsed['budget']['activeCount'],0)
                self.assertIsNone(runtime.operation)


def stat_mode(location):return location.stat().st_mode & 0o777

if __name__=='__main__': unittest.main()
