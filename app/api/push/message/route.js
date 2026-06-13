// Notifie tous les abonnés d'un nouveau message du chat
import webpush from "web-push";

export const dynamic = "force-dynamic";

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
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return Response.json({ ok: false, raison: "clés VAPID manquantes" }, { status: 500 });
  }
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return Response.json({ ok: false, raison: "KV non configuré" }, { status: 500 });
  }
  let body;
  try { body = await req.json(); } catch (e) { body = null; }
  const pseudo = (body?.pseudo || "Quelqu'un").toString().slice(0, 24);
  const texte = (body?.texte || "").toString().slice(0, 140);
  const exclure = body?.exclure || null; // endpoint de l'auteur (pas de notif pour lui)
  if (!texte.trim()) return Response.json({ ok: false, raison: "message vide" }, { status: 400 });

  webpush.setVapidDetails(
    "mailto:clement.pagney@gmail.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const charge = JSON.stringify({ title: "💬 " + pseudo, body: texte, url: "/?chat=1" });
  const brut = (await kv(["SMEMBERS", "push:abos"])) || [];
  let envoyes = 0;
  await Promise.all(
    brut.map(async (s) => {
      try {
        const sub = JSON.parse(s);
        if (exclure && sub.endpoint === exclure) return;
        await webpush.sendNotification(sub, charge);
        envoyes++;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await kv(["SREM", "push:abos", s]).catch(() => {});
        }
      }
    })
  );
  return Response.json({ ok: true, envoyes });
}
