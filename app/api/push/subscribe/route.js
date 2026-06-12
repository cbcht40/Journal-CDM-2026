// Enregistre un abonnement aux rappels dans Vercel KV (Redis)
async function kv(commande) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.KV_REST_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commande),
    cache: "no-store",
  });
  if (!r.ok) throw new Error("KV " + r.status);
  return (await r.json()).result;
}

export async function POST(req) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return Response.json({ ok: false, raison: "KV non configuré" }, { status: 500 });
  }
  let abo;
  try { abo = await req.json(); } catch (e) { abo = null; }
  if (!abo?.endpoint || !abo?.keys?.p256dh || !abo?.keys?.auth) {
    return Response.json({ ok: false, raison: "abonnement invalide" }, { status: 400 });
  }
  await kv(["SADD", "push:abos", JSON.stringify({ endpoint: abo.endpoint, keys: abo.keys })]);
  return Response.json({ ok: true });
}
