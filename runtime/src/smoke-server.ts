import { TELEGRAM_CONFORMANCE } from "./telegram/conformance.js";

const port = Number(Bun.env.PORT ?? "3000");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("invalid PORT");
}

const startedAt = Date.now();
Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "opencode-telegram-core-smoke",
        uptimeMs: Date.now() - startedAt,
        telegram: TELEGRAM_CONFORMANCE,
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(JSON.stringify({
  event: "core_smoke_ready",
  port,
  telegramBotApi: TELEGRAM_CONFORMANCE.botApiVersion,
  grammy: TELEGRAM_CONFORMANCE.grammyVersion,
}));
