import { spawn } from 'node:child_process';
const failures = [];
for (let attempt = 0; attempt < 12; attempt++) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  let closed = false;
  child.once('exit', () => { exited = true; });
  const completion = new Promise((resolve) => child.once('close', () => { closed = true; resolve(); }));
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.stdout.destroy();
  child.stderr.destroy();
  child.kill('SIGTERM');
  let timer;
  await Promise.race([completion, new Promise((resolve) => { timer = setTimeout(resolve, 500); })]);
  clearTimeout(timer);
  if (!closed) failures.push({ attempt, exited, exitCode: child.exitCode, signalCode: child.signalCode });
  if (!exited) child.kill('SIGKILL');
}
console.log(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', attempts: 12, failures }));
