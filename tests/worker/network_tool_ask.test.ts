import assert from 'node:assert/strict';
import { test } from 'node:test';
import networkTool from '../../worker/runtime_tools/network.ts';

type AskRecord = { permission: string; patterns: string[]; always: string[]; metadata: { input: Record<string, unknown> } };

function makeHarness(options: { rejectAsk?: boolean } = {}) {
  const asks: AskRecord[] = [];
  const networkCalls: Array<Record<string, unknown>> = [];
  const context = {
    ask: async (question: AskRecord) => {
      asks.push(question);
      if (options.rejectAsk) throw new Error('The user rejected the permission request.');
    },
    process: {
      network: async (args: Record<string, unknown>) => {
        networkCalls.push(args);
        return { ok: true, action: args.action };
      },
    },
  };
  return { asks, networkCalls, context };
}

test('ssh asks for ssh-remote permission before calling the network capability', async () => {
  const { asks, networkCalls, context } = makeHarness();
  const result = await networkTool.execute(
    { action: 'ssh', target: 'device-abc', user: 'root', command: 'uptime' },
    context,
  );
  assert.equal(asks.length, 1);
  assert.equal(asks[0]!.permission, 'ssh-remote');
  assert.deepEqual(asks[0]!.patterns, ['tailscale:device-abc:root']);
  assert.deepEqual(asks[0]!.always, []);
  const input = asks[0]!.metadata.input;
  assert.equal(input.hostname, 'device-abc');
  assert.equal(input.username, 'root');
  assert.equal(input.port, 22);
  assert.equal(input.network, 'Tailscale');
  assert.equal(input.command, 'uptime');
  assert.equal(typeof input.grantScope, 'string');
  assert.equal(networkCalls.length, 1);
  assert.equal(JSON.parse(result).ok, true);
});

test('rejecting the ssh prompt aborts before the network capability runs', async () => {
  const { asks, networkCalls, context } = makeHarness({ rejectAsk: true });
  await assert.rejects(
    () => networkTool.execute({ action: 'ssh', target: 'device-reject', user: 'ubuntu' }, context),
    /rejected the permission/u,
  );
  assert.equal(asks.length, 1);
  assert.equal(networkCalls.length, 0);
});

test('non-ssh actions never ask for permission', async () => {
  for (const action of ['status', 'devices', 'connect', 'disconnect', 'logout']) {
    const { asks, networkCalls, context } = makeHarness();
    await networkTool.execute({ action }, context);
    assert.equal(asks.length, 0, `action ${action} must not ask`);
    assert.equal(networkCalls.length, 1);
  }
});

test('ssh with a missing target or user skips the prompt and still reaches validation', async () => {
  const { asks, networkCalls, context } = makeHarness();
  await networkTool.execute({ action: 'ssh', user: 'root' }, context);
  assert.equal(asks.length, 0);
  assert.equal(networkCalls.length, 1);
});

test('a second ssh to the same target and user in this session does not re-ask', async () => {
  const { asks, networkCalls, context } = makeHarness();
  await networkTool.execute({ action: 'ssh', target: 'device-repeat', user: 'root', command: 'id' }, context);
  await networkTool.execute({ action: 'ssh', target: 'device-repeat', user: 'root', command: 'uptime' }, context);
  assert.equal(asks.length, 1, 'repeat ssh to same target+user must reuse the grant');
  assert.equal(networkCalls.length, 2);
});

test('ssh to the same target with a different user asks again', async () => {
  const { asks, networkCalls, context } = makeHarness();
  await networkTool.execute({ action: 'ssh', target: 'device-abc', user: 'ubuntu' }, context);
  assert.equal(asks.length, 1);
  assert.equal(networkCalls.length, 1);
});

test('governed network capability stays mandatory', async () => {
  await assert.rejects(
    () => networkTool.execute({ action: 'status' }, { ask: async () => {}, process: {} }),
    /Governed network capability is unavailable/u,
  );
});
