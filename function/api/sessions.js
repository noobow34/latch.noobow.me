// Cloudflare Pages Functions: /api/sessions
// KV binding name: SSH_SESSIONS
// キー設計:
//   "apikey"   → OCI Lambda APIキー文字列
//   "api_base" → API Gateway ベースURL
//   "sessions" → セッションJSON配列

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequest(ctx) {
  const { request, env } = ctx;

  // プリフライト
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const kv = env.SSH_SESSIONS;
  if (!kv) return json({ error: "KV binding 'SSH_SESSIONS' not found" }, 500);

  // ----------------------------------------
  // GET /api/sessions
  //   → { apikey, api_base, sessions }
  // ----------------------------------------
  if (request.method === "GET") {
    const [rawSessions, apikey, apiBase] = await Promise.all([
      kv.get("sessions"),
      kv.get("apikey"),
      kv.get("api_base"),
    ]);

    const sessions = rawSessions ? JSON.parse(rawSessions) : [];

    // 期限切れを除外
    const now = new Date();
    const valid = sessions.filter(s =>
      !s.autoCloseAt || new Date(s.autoCloseAt) > now
    );

    // 期限切れがあればKVも更新
    if (valid.length !== sessions.length) {
      await kv.put("sessions", JSON.stringify(valid));
    }

    return json({
      apikey:   apikey  || null,
      api_base: apiBase || null,
      sessions: valid,
    });
  }

  // ----------------------------------------
  // POST /api/sessions → セッション追加
  // body: { id, ip4, ip6, createdAt, autoCloseAt }
  // ----------------------------------------
  if (request.method === "POST") {
    const body = await request.json();
    if (!body.id) return json({ error: "id is required" }, 400);

    const raw = await kv.get("sessions");
    const sessions = raw ? JSON.parse(raw) : [];

    const idx = sessions.findIndex(s => s.id === body.id);
    if (idx >= 0) sessions[idx] = body;
    else sessions.unshift(body);

    await kv.put("sessions", JSON.stringify(sessions));
    return json({ ok: true });
  }

  // ----------------------------------------
  // DELETE /api/sessions → セッション削除
  // body: { id }
  // ----------------------------------------
  if (request.method === "DELETE") {
    const body = await request.json();
    if (!body.id) return json({ error: "id is required" }, 400);

    const raw = await kv.get("sessions");
    const sessions = raw ? JSON.parse(raw) : [];
    await kv.put("sessions", JSON.stringify(sessions.filter(s => s.id !== body.id)));
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}
