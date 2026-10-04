"""Candidate failure fallback; unshipped and restricted to the validation container.
Reuse baseline identity/model fixtures, but assert the corrected live retirement.
Essential child loss retires this whole namespace; it never starts replacement Bun.
"""
import importlib.util, json, os, signal, subprocess, sys, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
spec=importlib.util.spec_from_file_location('baseline',Path(__file__).with_name('probe.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
EVIDENCE=p.EVIDENCE
LIVE=None; CAPTURED=None; RUNNER=None

def cases():
    global LIVE,CAPTURED,RUNNER
    try:
        EVIDENCE['environment']=p.environment()
        assert 'tini' in EVIDENCE['environment']['initCmdline'] or 'dumb-init' in EVIDENCE['environment']['initCmdline']
        runtime,captured=p.paused_server()
        try:
            before=p.identity(captured['pid'])
            runtime.process.terminate();runtime.process.wait(timeout=15)
            p.wait_for(lambda:not p.same(p.identity(captured['pid']),captured))
            assert runtime.process.returncode==0
            EVIDENCE['cases']['normalPausedShutdown']={'before':before,'after':p.identity(captured['pid']),'exit':0}
        finally: runtime.close()
        p.MODE='escape'
        with p.Server(p.BINARY,readiness_path='/global/health',configure=p.configure) as runtime:
            client=p.Client(runtime.base);sid=client.request('POST','/session',{})['id']
            client.request('POST',f'/session/{sid}/message',{'parts':[{'type':'text','text':'fixture'}],
                'model':{'providerID':'fixture','modelID':'fixture'}},timeout=45)
            history=json.dumps(client.request('GET',f'/session/{sid}/message'))
            assert 'boundary-escaped-success' in history and '"status": "error"' not in history,history
            pid=int((p.roots[-1]/'owned-pid').read_text());after=p.identity(pid)
            assert after is None,after
            assert client.request('POST','/global/dispose',timeout=15)
            assert p.identity(pid) is None
            EVIDENCE['cases']['joinedDoubleFork']={'causalReady':True,'pid':pid,'afterCompletion':after,'dispose':True}
        LIVE,CAPTURED=p.paused_server();RUNNER=p.identity(CAPTURED['ppid'])
        assert RUNNER and RUNNER['ppid']==LIVE.process.pid,RUNNER
        EVIDENCE['armed']={'runtime':p.identity(LIVE.process.pid),'pausedShell':p.identity(CAPTURED['pid']),'runner':RUNNER}
        def essential():
            code=LIVE.process.wait()
            p.emit('essentialLoss',exitCode=code)
            os._exit(75)
        threading.Thread(target=essential,daemon=True).start()
        # This detached witness belongs to the diagnostic namespace, not a Core
        # scope. Its fresh heartbeat proves actual outer teardown on authority loss.
        assert p.WITNESS,'independent receiver required'
        child=('import json,os,time,urllib.request; os.setsid(); c=os.fork();\nif c: os._exit(0)\n'+
            f'url={p.WITNESS!r}; token={p.TOKEN!r}; boot={p.BOOT!r}; end=time.monotonic()+300\n'+
            'while time.monotonic()<end:\n'+
            ' try:\n'+
            '  event={"kind":"heartbeat","boot":boot,"pid":os.getpid(),"namespace":os.readlink("/proc/self/ns/pid")}\n'+
            '  urllib.request.urlopen(urllib.request.Request(url,data=json.dumps(event).encode(),headers={"content-type":"application/json","authorization":token}),timeout=2).close()\n'+
            ' except Exception: pass\n time.sleep(.25)\n')
        launcher=subprocess.Popen([sys.executable,'-c',child],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        launcher.wait(timeout=5)
        EVIDENCE['ready']=True;p.emit('armed',evidence=EVIDENCE)
    except BaseException as error:
        EVIDENCE['errors'].append(repr(error));p.emit('probeError',error=repr(error))

class HTTP(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        response=EVIDENCE if self.headers.get('authorization')==p.TOKEN else {'ready':EVIDENCE.get('ready',False)}
        raw=json.dumps(response).encode();self.send_response(200 if EVIDENCE.get('ready') else 503);self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        if self.headers.get('authorization')!=p.TOKEN:self.send_error(403);return
        if self.path not in ('/kill-bun','/kill-runner','/exit-wrapper') or not EVIDENCE.get('ready'):self.send_error(409);return
        target=EVIDENCE['armed']['runtime'] if self.path=='/kill-bun' else RUNNER
        assert p.same(p.identity(target['pid']),target),'captured identity changed'
        assert p.same(p.identity(CAPTURED['pid']),CAPTURED) and p.identity(CAPTURED['pid'])['state']=='T'
        p.emit('action',action=self.path,target=target,pausedShell=p.identity(CAPTURED['pid']))
        self.send_response(200);self.end_headers();self.wfile.write(b'{}');self.wfile.flush()
        if self.path=='/exit-wrapper':os._exit(73)
        os.kill(target['pid'],signal.SIGKILL)

if __name__=='__main__':
    threading.Thread(target=cases,daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','3000'))),HTTP).serve_forever()
