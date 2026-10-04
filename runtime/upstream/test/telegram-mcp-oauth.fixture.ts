import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
export function oauthPeer() {
  return Effect.acquireRelease(Effect.promise(async () => {
    const protocol = new Server({ name: "owned-oauth-fixture", version: "1" }, { capabilities: { tools: {} } })
    protocol.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true })
    await protocol.connect(transport)
    const challenges = new Map<string, string>()
    const exchanges: string[] = []
    const registrations: string[] = []
    let registrationGate: Promise<void> | undefined
    let tokenGate: Promise<void> | undefined
    let onRegistration = () => {}
    let onToken = () => {}
    const http = Bun.serve({ port: 0, async fetch(request) {
      const { origin, pathname } = new URL(request.url)
      if (pathname.startsWith("/.well-known/oauth-protected-resource")) return Response.json({ resource: origin + "/mcp", authorization_servers: [origin] })
      if (pathname === "/.well-known/oauth-authorization-server") return Response.json({ issuer: origin, authorization_endpoint: origin + "/authorize", token_endpoint: origin + "/token", registration_endpoint: origin + "/register", response_types_supported: ["code"], grant_types_supported: ["authorization_code"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] })
      if (pathname === "/register") {
        registrations.push(request.url)
        onRegistration(); await registrationGate
        return Response.json({ ...await request.json() as object, client_id: "fixture-client" }, { status: 201 })
      }
      if (pathname === "/token") {
        const body = new URLSearchParams(await request.text())
        const code = body.get("code") ?? ""
        exchanges.push(code); onToken(); await tokenGate
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier") ?? ""))
        if (challenges.get(code) !== Buffer.from(digest).toString("base64url")) return Response.json({ error: "invalid_grant" }, { status: 400 })
        return Response.json({ access_token: "fixture-token", token_type: "Bearer" })
      }
      if (pathname !== "/mcp") return new Response(null, { status: 404 })
      if (request.method === "GET") return new Response(null, { status: 405 })
      if (request.headers.get("authorization") !== "Bearer fixture-token") return new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource"' } })
      return transport.handleRequest(request)
    } })
    return {
      url: new URL("/mcp", http.url).toString(), exchanges, registrations,
      authorize(url: string, code: string) { challenges.set(code, new URL(url).searchParams.get("code_challenge")!) },
      blockRegistration(gate: Promise<void>, entered: () => void) { registrationGate = gate; onRegistration = entered },
      blockToken(gate: Promise<void>, entered: () => void) { tokenGate = gate; onToken = entered },
      async close() { await http.stop(true); await protocol.close() },
    }
  }), peer => Effect.promise(() => peer.close()))
}
