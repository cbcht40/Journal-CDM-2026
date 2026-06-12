// Rappels planifiés (Vercel Cron) : 10h et 22h heure de Paris
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

const MESSAGES_MATIN = [
  "Les matchs du jour arrivent — prépare tes tickets ⚽",
  "Coup d'œil au programme du jour : qui tu vois gagner ? 🎫",
  "Nouveau jour de Mondial — valide tes paris avant le coup d'envoi ⏱️",
];
const MESSAGES_SOIR = [
  "Tamponne tes tickets du jour : Gagné, Perdu ? Preuve à l'appui 📷",
  "Avant de dormir : mets ton carnet à jour, le classement attend 🏆",
  "Les matchs sont finis — règle tes tickets et regarde le classement 👀",
];

export async function GET(req) {
  // Vercel Cron envoie « Authorization: Bearer CRON_SECRET » si la variable existe
  if (process.env.CRON_SECRET) {
    if (req.headers.get("authorization") !== "Bearer " + process.env.CRON_SECRET) {
      return new Response("Non autorisé", { status: 401 });
    }
  }
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return Response.json({ ok: false, raison: "clés VAPID manquantes" }, { status: 500 });
  }

  webpush.setVapidDetails(
    "mailto:clement.pagney@gmail.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const heure = Number(
    new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Europe/Paris" })
      .format(new Date())
  );
  const matin = heure < 16;
  const liste = matin ? MESSAGES_MATIN : MESSAGES_SOIR;
  const jour = Math.floor(Date.now() / 86400000);
  const charge = JSON.stringify({
    title: "Journal CDM 2026",
    body: liste[jour % liste.length],
  });

  const brut = (await kv(["SMEMBERS", "push:abos"])) || [];
  let envoyes = 0, morts = 0;
  await Promise.all(
    brut.map(async (s) => {
      try {
        await webpush.sendNotification(JSON.parse(s), charge);
        envoyes++;
      } catch (e) {
        // Abonnement expiré ou révoqué : on le retire
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await kv(["SREM", "push:abos", s]).catch(() => {});
          morts++;
        }
      }
    })
  );
  return Response.json({ ok: true, envoyes, retires: morts, heure });
}
