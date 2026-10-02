import fs from 'node:fs';
import crypto from 'node:crypto';
const base='https://github.com/aminsh35322088-ctrl/opencode-telegram-core/releases/download/v1.18.33-bot.13-pre.7/';
const manifest=await (await fetch(base+'release-manifest.json')).json();
if(manifest.telegramCoreCommit!=='ce78773da013922ffd19419fc51f894fc586aaac')throw Error('Manifest mismatch');
const sums=await (await fetch(base+'SHA256SUMS')).text();
const lock=JSON.parse(fs.readFileSync('core-release.lock.json','utf8'));
let pkg=fs.readFileSync('package.json','utf8');
let npm=fs.readFileSync('package-lock.json','utf8');
for(const [key,entry] of Object.entries(lock.assets)){
 const lines=sums.split('\n').filter(l=>l.trim().endsWith('  '+entry.name));
 if(lines.length!==1)throw Error('Checksum mismatch '+entry.name);
 entry.sha256=lines[0].split(/\s+/)[0];
 if(key==='runtime')continue;
 const response=await fetch(base+entry.name);if(!response.ok)throw Error('Download failed');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Artifact mismatch');
 const dep=key==='sdk'?'@opencode-ai/sdk':'@opencode-telegram/native-runtime';
 const previous=JSON.parse(npm).packages['node_modules/'+dep].integrity;
 if(!previous)throw Error('Missing integrity');
 npm=npm.replace(previous,'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64'));
}
Object.assign(lock,{tag:'v1.18.33-bot.13-pre.7',telegramCoreVersion:'1.18.33-bot.13-pre.7',telegramCoreCommit:manifest.telegramCoreCommit});
fs.writeFileSync('core-release.lock.json',JSON.stringify(lock,null,2)+'\n');
fs.writeFileSync('package.json',pkg.replaceAll('bot.13-pre.6','bot.13-pre.7'));
fs.writeFileSync('package-lock.json',npm.replaceAll('bot.13-pre.6','bot.13-pre.7'));