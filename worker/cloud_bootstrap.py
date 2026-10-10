"""Cloud Control Plane join; one-time token is never inherited by Core/model children."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

LIMIT=16*1024
METADATA={'identity','secretFingerprint','snapshotHighwater','activatedSnapshotHighwater','pendingGlobalSync','retired'}

def _identity(value):
 if not isinstance(value,dict) or set(value)!={'nodeId','generation','chatId','threadId'}:
  raise ValueError('invalid node identity')
 if not isinstance(value['nodeId'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',value['nodeId']):
  raise ValueError('invalid node identity')
 if any(type(value[k]) is not int or abs(value[k])>9007199254740991 for k in ('generation','chatId','threadId')) or value['generation']<1:
  raise ValueError('invalid node identity')
 if (value['chatId'],value['threadId'])!=(0,0) and (value['chatId']==0 or value['threadId']<=1):
  raise ValueError('invalid node scope')

def _regular(path, private=True):
 metadata=path.lstat()
 if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid!=os.getuid() or (private and metadata.st_mode&0o077):
  raise ValueError('invalid node credential cache')

def _cached(target,control_url,service_id,project_id):
 if not (target.exists() or target.is_symlink()):return None
 _regular(target)
 if target.stat().st_size>LIMIT:raise ValueError('invalid node credential cache')
 cached=json.loads(target.read_text());_identity(cached.get('identity'))
 if cached.get('controlUrl')!=control_url.rstrip('/') or cached.get('serviceId')!=service_id or cached.get('projectId')!=project_id:
  raise ValueError('foreign node credential cache')
 if not isinstance(cached.get('secret'),str) or len(cached['secret'])<48:raise ValueError('invalid node key')
 return cached

def _known(root):
 ledger=root/'agent.sqlite'
 if not (ledger.exists() or ledger.is_symlink()):return None
 _regular(ledger,False)
 with sqlite3.connect(ledger.as_uri()+'?mode=ro',uri=True) as db:
  rows=dict(db.execute('SELECT key,value FROM state'))
 if not rows:return None
 identity=json.loads(rows.get('identity','null'));_identity(identity)
 fingerprint=json.loads(rows.get('secretFingerprint','null'));retired=json.loads(rows.get('retired','false'))
 if not isinstance(fingerprint,str) or not re.fullmatch('[a-f0-9]{64}',fingerprint) or type(retired) is not bool:
  raise ValueError('invalid bootstrap durable state')
 durable=any(json.loads(value) not in (None,False) for key,value in rows.items() if key not in METADATA)
 topic=root.parent/'topic'
 if topic.is_symlink() or (topic.exists() and any(path.is_file() or path.is_symlink() for path in topic.rglob('*'))):durable=True
 return {'identity':identity,'secretFingerprint':fingerprint,'retired':retired,'durable':durable}

def _authorize_transition(known,identity,secret):
 fingerprint=hashlib.sha256(secret.encode()).hexdigest()
 if known is None:return
 identical=known['identity']==identity and known['secretFingerprint']==fingerprint and not known['retired']
 prior=known['identity'];prior_unbound=(prior['chatId'],prior['threadId'])==(0,0);next_unbound=(identity['chatId'],identity['threadId'])==(0,0)
 rotated=(prior['nodeId']==identity['nodeId'] and identity['generation']==prior['generation']+1 and known['retired'] and not known['durable'] and known['secretFingerprint']!=fingerprint and prior_unbound!=next_unbound)
 if not identical and not rotated:raise ValueError('bootstrap identity transition requires clean retired generation and rotated secret')

class _NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*_):raise ValueError('bootstrap redirect rejected')

def _request(endpoint,payload):
 raw=json.dumps(payload,separators=(',',':')).encode()
 request=Request(endpoint,data=raw,headers={'Content-Type':'application/json','User-Agent':'OpenCodeTelegramCore/1'},method='POST')
 with build_opener(_NoRedirect()).open(request,timeout=15) as response:
  body=response.read(LIMIT+1)
  if response.status!=200 or len(body)>LIMIT:raise ValueError('bootstrap response rejected')
  return json.loads(body)

def _save(root,cached):
 target=root/'node-credentials.json';temporary=root/('.credentials-'+secrets.token_hex(16));descriptor=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 try:
  with os.fdopen(descriptor,'w') as handle:json.dump(cached,handle,separators=(',',':'));handle.flush();os.fsync(handle.fileno())
  os.replace(temporary,target);directory=os.open(root,os.O_RDONLY)
  try:os.fsync(directory)
  finally:os.close(directory)
 finally:
  if temporary.exists():temporary.unlink()

def resolve_cloud_identity(root,bootstrap_token,control_url,service_id,project_id,*,transport=_request):
 url=urlsplit(control_url)
 if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
  raise ValueError('invalid control endpoint')
 if not service_id or not project_id:raise ValueError('Railway service identity missing')
 root=Path(root).absolute();root.mkdir(parents=True,exist_ok=True,mode=0o700)
 metadata=root.lstat()
 if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid!=os.getuid() or metadata.st_mode&0o077:
  raise ValueError('invalid bootstrap root')
 target=root/'node-credentials.json';cached=_cached(target,control_url,service_id,project_id)
 # A consumed/missing bootstrap token is a normal restart: the durable cache is authoritative.
 if not isinstance(bootstrap_token,str) or len(bootstrap_token)<48:
  if cached:return cached
  raise ValueError('bootstrap token unavailable')
 response=transport(control_url.rstrip('/')+'/nodes/bootstrap',{'bootstrapToken':bootstrap_token,'serviceId':service_id,'projectId':project_id})
 if not isinstance(response,dict) or response.get('version')!=1:raise ValueError('invalid bootstrap response')
 _identity(response.get('identity'))
 if not isinstance(response.get('secret'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{48,128}',response['secret']):raise ValueError('invalid node key')
 _authorize_transition(_known(root),response['identity'],response['secret'])
 next_cached={'version':1,'identity':response['identity'],'secret':response['secret'],'controlUrl':control_url.rstrip('/'),'serviceId':service_id,'projectId':project_id}
 _save(root,next_cached)
 return next_cached
