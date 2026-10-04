// Validation-only external observer. No production data; bounded in-memory events.
const token = Bun.env.BOUNDARY_TOKEN!;
if (!token) throw Error('BOUNDARY_TOKEN required');
const events: unknown[] = [];
Bun.serve({port: Number(Bun.env.PORT || 3000), async fetch(request) {
  if (request.headers.get('authorization') !== token) return new Response('forbidden', {status: 403});
  if (request.method === 'POST') {
    const raw = await request.text();
    if (raw.length > 100000) return new Response('too large', {status: 413});
    events.push({receivedAt: Date.now(), event: JSON.parse(raw)});
    if (events.length > 2048) events.splice(0, events.length - 2048);
  }
  return Response.json({now: Date.now(), events});
}});
