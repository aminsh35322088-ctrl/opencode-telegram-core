import sys, json, pathlib
REPOSITORY = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY / 'tests/compatibility'))
from session_contract import Server, Client
roots=[]
def configure(root, env):
    roots.append(root)
    marker=root/'aws-helper-started'
    helper=root/'aws-helper.py'
    helper.write_text('import pathlib,json\npathlib.Path('+repr(str(marker))+').write_text("started")\nprint(json.dumps({"Version":1,"AccessKeyId":"fixture","SecretAccessKey":"fixture"}))\n')
    config=root/'aws-config'; config.write_text('[profile core-fixture]\ncredential_process = '+sys.executable+' '+str(helper)+'\n')
    credentials=root/'aws-credentials'; credentials.write_text('')
    env.update(AWS_CONFIG_FILE=str(config),AWS_SHARED_CREDENTIALS_FILE=str(credentials),AWS_PROFILE='core-fixture',AWS_EC2_METADATA_DISABLED='true',OPENCODE_TELEGRAM_PROCESS_BUDGET='1')
    env['OPENCODE_CONFIG_CONTENT']=json.dumps({'permission':'allow','provider':{'amazon-bedrock':{'options':{'profile':'core-fixture','region':'us-east-1','endpoint':'http://127.0.0.1:1'},'models':{'fixture':{'name':'Fixture','limit':{'context':32000,'output':1024}}}}}})
with Server(str(REPOSITORY / 'dist/runtime/opencode'),readiness_path='/global/health',configure=configure) as server:
    c=Client(server.base); sid=c.request('POST','/session',{})['id']
    try: c.request('POST',f'/session/{sid}/message',{'parts':[{'type':'text','text':'fixture'}],'model':{'providerID':'amazon-bedrock','modelID':'fixture'}},timeout=30)
    except Exception as e: print('request_failed',type(e).__name__)
    print(json.dumps({'compiledHelperStarted':(roots[0]/'aws-helper-started').exists()}))
    c.request('POST','/global/dispose',timeout=15)
