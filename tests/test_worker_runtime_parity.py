"""Guard the image/tool capability boundary, independent of Docker availability."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RuntimeParityTests(unittest.TestCase):
    def test_online_profile_requires_the_native_tools_only_path(self):
        result = subprocess.run(['python3', str(ROOT / 'scripts/worker-runtime-smoke.py'), '--online'],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 2)
        self.assertIn('--online requires --tools-only', result.stderr)

    def test_browser_uses_native_governed_context_and_rejects_missing_authority(self):
        script = '''const fs=require('fs'),vm=require('vm');
const box={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8').replace('export default','module.exports ='),box);
const tool=box.module.exports;
(async()=>{let accepted=[];
const context={process:{browser:async x=>{accepted.push(x);return {stdout:'governed',stderr:''}}}};
if(await tool.execute({action:'fill',ref:'e1',text:'hello',session:'one'},context)!=='governed')throw Error('result');
if(JSON.stringify(accepted[0])!==JSON.stringify({action:'fill',args:['e1','hello'],session:'one',timeout:120000,maxBuffer:2097152}))throw Error('mapping');
for(const [args,ctx] of [[{action:'open'},{}],[{action:'exec'},context],[{action:'fill'},context],[{action:'goto'},context]]){
let rejected=false;try{await tool.execute(args,ctx)}catch{rejected=true}if(!rejected)throw Error('authority accepted');}
if(accepted.length!==1)throw Error('unexpected execution');
})().catch(e=>{console.error(e.message);process.exit(1)});'''
        subprocess.run(['node', '-e', script, str(ROOT / 'worker/runtime_tools/browser.ts')], check=True,
                       capture_output=True, text=True, timeout=10)

    def test_runtime_inspection_tool_forwards_only_captured_topic_context(self):
        script = '''const fs=require('fs'),vm=require('vm');
const calls=[];const box={module:{exports:{}},fetch:async (url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,result:{section:'verify',passed:true}})}}};
vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8').replace('export default','module.exports ='),box);
const tool=box.module.exports;
(async()=>{
for(const action of ['capabilities','diagnostics','verify']){
const result=await tool.execute({action},{sessionID:'ses_owned',messageID:'msg_current'});
if(!JSON.parse(result).passed && action==='verify')throw Error('result');
}
if(calls.length!==3)throw Error('unexpected request count');
for(let i=0;i<calls.length;i++){
if(calls[i].url!=='http://127.0.0.1:4098/control')throw Error('endpoint');
if(calls[i].body.action!=='runtime.inspect'||calls[i].body.sessionId!=='ses_owned'||calls[i].body.payload.messageID!=='msg_current')throw Error('context');
if(calls[i].body.payload.section!==['capabilities','diagnostics','verify'][i])throw Error('section');
if(Object.keys(calls[i].body).sort().join(',')!=='action,payload,sessionId')throw Error('extra authority');
}
for(const [args,ctx] of [[{action:'exec'},{sessionID:'ses',messageID:'msg'}],[{action:'verify'},{sessionID:'ses'}]]){
let rejected=false;try{await tool.execute(args,ctx)}catch{rejected=true}if(!rejected)throw Error('invalid request accepted');
}
if(calls.length!==3)throw Error('invalid request reached bridge');
})().catch(e=>{console.error(e.message);process.exit(1)});'''
        subprocess.run(['node', '-e', script, str(ROOT / 'worker/runtime_tools/runtime.ts')], check=True,
                       capture_output=True, text=True, timeout=10)

    def test_runtime_tool_is_present_in_worker_image_source_tree(self):
        source = (ROOT / 'Dockerfile.worker').read_text()
        self.assertIn('COPY worker /opt/worker', source)
        self.assertIn("RUNTIME_TOOL_SOURCE = Path(__file__).parent / \"runtime_tools\" / \"runtime.ts\"", (ROOT / 'worker/node_agent.py').read_text())
        agent = (ROOT / 'worker/node_agent.py').read_text()
        self.assertIn('materialize_runtime_tool(tools)', agent)
        self.assertIn("'runtime.ts'", agent)

    def test_core_dependency_layer_is_stable_across_runtime_source_and_commit_changes(self):
        source = (ROOT / 'Dockerfile.worker').read_text()
        prepare = source.index('./scripts/prepare-runtime-deps.sh')
        runtime_copy = source.index('COPY runtime ./runtime')
        source_commit = source.index('ARG CORE_SOURCE_COMMIT')
        compile_step = source.index('./scripts/compile-runtime.sh')
        self.assertLess(prepare, runtime_copy)
        self.assertLess(prepare, source_commit)
        self.assertLess(runtime_copy, compile_step)
        self.assertIn('--mount=type=cache,target=/root/.bun/install/cache', source)
        before_prepare=source[:prepare]
        self.assertNotIn('COPY scripts ./scripts', before_prepare)
        self.assertIn('scripts/prepare-runtime-deps.sh', before_prepare)
        self.assertNotIn('scripts/worker-runtime-smoke.py', before_prepare)
        self.assertGreater(source.index('scripts/compile-runtime.sh'), prepare)

    def test_local_build_wrapper_preserves_prepare_then_compile_contract(self):
        wrapper = (ROOT / 'scripts/build-runtime.sh').read_text()
        self.assertIn('prepare-runtime-deps.sh', wrapper)
        self.assertIn('compile-runtime.sh', wrapper)
        self.assertLess(wrapper.index('prepare-runtime-deps.sh'), wrapper.index('compile-runtime.sh'))

    def test_image_pins_browser_runtime_and_keeps_runtime_artifacts_off_volume(self):
        source = (ROOT / 'Dockerfile.worker').read_text()
        self.assertIn('FROM node:22.14.0-bookworm-slim AS runtime', source)
        self.assertIn('@playwright/cli@0.1.18', source)
        self.assertIn('PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright', source)
        self.assertIn('@playwright/cli/node_modules/playwright-core/cli.js', source)
        self.assertIn('install chromium --with-deps --no-shell', source)
        self.assertNotIn('chromium_headless_shell-*', source)
        self.assertIn('OPENCODE_TELEGRAM_PROCESS_BUDGET=1', source)
        self.assertIn('bash coreutils findutils lsof', source)
        self.assertNotIn('PORT=3000', source)
        self.assertIn('EXPOSE 8080', source)
        self.assertIn('tailscale_1.104.1_${arch}.tgz', source)
        self.assertIn('sha256sum -c -', source)
        self.assertNotIn('tailscale.com/install.sh', source)
        self.assertNotIn('COPY --from=build /root/.bun', source)
        self.assertIn('npm_config_cache=/tmp/npm-cache', source)
        self.assertIn('COPY --from=build /core/dist/runtime/opencode', source)
