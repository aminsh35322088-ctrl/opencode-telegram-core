#!/usr/bin/env python3
"""Compiled durable pause fencing; no replacement of a lost live continuation.
The caller supplies a disposable persistent data directory. This diagnostic never
claims that a same-container restart provides process-tree crash containment.
"""
import argparse, io, json, os, shlex, sys, threading, time
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0, os.environ.get('COMPILED_FIXTURE_TESTS', str(Path(__file__).resolve().parents[2] / 'compatibility')))
from session_contract import Server, Client, HttpError
from production_execution import Model, plugin_registry

class TurnModel(Model):
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['content-length'])))
        latest=max(i for i,m in enumerate(body['messages']) if m['role']=='user')
        body['messages']=body['messages'][latest:]
        raw=json.dumps(body).encode();self.rfile=io.BytesIO(raw)
        self.headers.replace_header('content-length',str(len(raw)))
        self.server.calls+=1
        super().do_POST()

def wait(fn):
    end=time.monotonic()+15
    while time.monotonic()<end:
        if fn():return
        time.sleep(.02)
    raise AssertionError('bounded causal observation expired')

def run(binary,data):
    data.mkdir(parents=True,exist_ok=True)
    provider=ThreadingHTTPServer(('127.0.0.1',0),TurnModel);provider.calls=0
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    registry=plugin_registry();roots=[]
    def configure(root,env):
        roots.append(root)
        for key,name in [('HOME','home'),('XDG_DATA_HOME','data'),('XDG_CONFIG_HOME','config'),('XDG_STATE_HOME','state'),('XDG_CACHE_HOME','cache')]:
            path=data/name;path.mkdir(exist_ok=True);env[key]=str(path)
        config=root/'.opencode';config.mkdir()
        (config/'.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
        env.update(NPM_CONFIG_REGISTRY=f'http://127.0.0.1:{registry.server_port}/',OPENCODE_CONFIG_DIR=str(config),
            OPENCODE_CONFIG_CONTENT=json.dumps({'model':'fixture/fixture','permission':'allow','provider':{'fixture':{
                'npm':'@ai-sdk/openai-compatible','name':'Fixture','options':{'baseURL':f'http://127.0.0.1:{provider.server_port}/v1','apiKey':'fixture'},
                'models':{'fixture':{'name':'Fixture','limit':{'context':32000,'output':2048}}}}}}))
    prompt={'parts':[{'type':'text','text':'Recovery fixture'}],'model':{'providerID':'fixture','modelID':'fixture'}}
    evidence={}
    try:
        with Server(binary,readiness_path='/global/health',configure=configure) as runtime:
            client=Client(runtime.base);sid=client.request('POST','/session',{})['id']
            marker=roots[-1]/'shell-pid'
            provider.command='echo $$ > '+shlex.quote(str(marker))+'; exec sleep 120'
            client.request('POST',f'/session/{sid}/prompt_async',prompt)
            wait(marker.exists);pid=int(marker.read_text())
            old=client.request('GET',f'/session/{sid}/execution')
            assert client.request('POST',f'/session/{sid}/pause',{'runId':old['runId']})['paused']
            wait(lambda:Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[0]=='T')
            evidence['before']={'session':sid,'owner':old,'physicallyPausedPid':pid}
            runtime.process.kill();runtime.process.wait(timeout=10)
        with Server(binary,readiness_path='/global/health',configure=configure) as runtime:
            client=Client(runtime.base)
            recovered=client.request('GET',f'/session/{sid}/execution')
            assert recovered=={'runId':old['runId'],'paused':True,'continuation':'unavailable'},recovered
            before_calls=provider.calls
            for action,owner in [('resume',old['runId']),('pause',old['runId']),('abort','foreign-owner')]:
                try:client.request('POST',f'/session/{sid}/{action}',{'runId':owner})
                except HttpError as error:assert '409' in str(error),str(error)
                else:raise AssertionError('stale control accepted: '+action)
            assert provider.calls==before_calls,'recovery replayed model/tool work'
            assert client.request('GET',f'/session/{sid}/execution')==recovered
            assert client.request('POST',f'/session/{sid}/abort',{'runId':old['runId']}) is True
            assert client.request('GET',f'/session/{sid}/execution') is None
            fresh_marker=roots[-1]/'fresh-pid'
            provider.command='printf recovery-fresh-authority; echo $$ > '+shlex.quote(str(fresh_marker))+'; exec sleep 120'
            client.request('POST',f'/session/{sid}/prompt_async',prompt)
            wait(fresh_marker.exists)
            fresh=client.request('GET',f'/session/{sid}/execution')
            assert fresh and fresh['runId']!=old['runId'] and fresh['continuation']=='live',fresh
            try:client.request('POST',f'/session/{sid}/abort',{'runId':old['runId']})
            except HttpError as error:assert '409' in str(error),str(error)
            else:raise AssertionError('old abort adopted fresh authority')
            assert client.request('GET',f'/session/{sid}/execution')==fresh
            assert client.request('POST',f'/session/{sid}/abort',{'runId':fresh['runId']}) is True
            evidence.update(recovered=recovered,staleControlsRejected=True,noImplicitReplay=True,explicitAbortClearedIntent=True,fresh=fresh)
        return evidence
    finally:provider.shutdown();registry.shutdown()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);parser.add_argument('--data',required=True)
    args=parser.parse_args();print(json.dumps(run(args.binary,Path(args.data))))
