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

    def test_image_pins_browser_runtime_and_keeps_runtime_artifacts_off_volume(self):
        source = (ROOT / 'Dockerfile.worker').read_text()
        self.assertIn('FROM node:22.14.0-bookworm-slim AS runtime', source)
        self.assertIn('@playwright/cli@0.1.18', source)
        self.assertIn('PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright', source)
        self.assertIn('OPENCODE_TELEGRAM_PROCESS_BUDGET=1', source)
        self.assertIn('bash coreutils findutils lsof', source)
        self.assertNotIn('PORT=3000', source)
        self.assertIn('EXPOSE 8080', source)
        self.assertNotIn('tailscaled', source)
        self.assertNotIn('COPY --from=build /root/.bun', source)
        self.assertIn('npm_config_cache=/tmp/npm-cache', source)
        self.assertIn('COPY --from=build /core/dist/runtime/opencode', source)
