// Dessin de la carte de stats partageable (image + page publique) — un seul moteur
// data : { pseudo, bankroll, depart, investi, pnl, pnlPct, roi, reussite, regles, enCours, last5, courbe }
// opts : { n: pseudo, m: montants €, p: % rendement, c: courbe, s: stats détaillées }

const COL = {
  pelouse: "#0E5A3C", pelouse2: "#0A4530", craie: "#F1F2EC", ticket: "#FFFFFF",
  encre: "#15241C", dim: "rgba(255,255,255,.7)", or: "#E7C45A",
  gagne: "#5FD08A", perdu: "#F09A8E", remb: "#C9D2CC", ligne: "rgba(255,255,255,.18)",
};

const eur = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const pct1 = (n) => (n > 0 ? "+" : "") + (Number(n) || 0).toFixed(1).replace(".", ",") + " %";
const pctReussite = (n) => n == null ? "—" : (n * 100).toFixed(0) + " %";

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function dessinerCarte(canvas, data, opts) {
  const W = 1080, P = 72;
  const o = { n: true, m: true, p: true, c: true, s: true, ...opts };

  // Hauteur dynamique selon les sections activées
  let H = 96; // marge haut + label
  H += o.n ? 96 : 40;            // pseudo
  if (o.p) H += 240;            // grand % de P&L
  if (o.m) H += 150;            // bankroll / investi
  if (o.c) H += 360;            // courbe
  if (o.s) H += 300;            // grille de stats
  H += 150;                     // pied de page
  H = Math.max(H, 720);

  const ratio = 2;
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  canvas.style.width = "100%";
  canvas.style.maxWidth = W + "px";
  canvas.style.height = "auto";
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  // Fond pelouse à bandes
  ctx.fillStyle = COL.pelouse;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COL.pelouse2;
  const bande = W / 8;
  for (let i = 0; i < 8; i += 2) ctx.fillRect(i * bande, 0, bande, H);
  // Cadre craie
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = 4;
  rrect(ctx, 16, 16, W - 32, H - 32, 28); ctx.stroke();

  let y = 84;
  ctx.textBaseline = "alphabetic";

  // Label
  ctx.fillStyle = COL.or;
  ctx.font = "700 26px sans-serif";
  ctx.fillText("⚽ JOURNAL CDM 2026", P, y);
  y += o.n ? 78 : 40;

  // Pseudo
  if (o.n && data.pseudo) {
    ctx.fillStyle = "#fff";
    ctx.font = "800 64px sans-serif";
    ctx.fillText("@" + data.pseudo, P, y);
    y += 30;
  }

  // Grand % de P&L
  if (o.p) {
    y += 96;
    const positif = (data.pnlPct ?? 0) >= 0;
    ctx.fillStyle = COL.dim;
    ctx.font = "700 24px sans-serif";
    ctx.fillText("RENDEMENT (% DE P&L)", P, y - 96);
    ctx.fillStyle = positif ? COL.gagne : COL.perdu;
    ctx.font = "800 128px sans-serif";
    ctx.fillText(pct1(data.pnlPct), P, y);
    y += 60;
  }

  // Montants
  if (o.m) {
    ctx.fillStyle = "#fff";
    ctx.font = "700 40px sans-serif";
    ctx.fillText("Bankroll " + eur(data.bankroll), P, y);
    ctx.fillStyle = COL.dim;
    ctx.font = "400 28px sans-serif";
    ctx.fillText("investi " + eur(data.investi ?? data.depart) + (data.pnl != null ? "  ·  P&L " + (data.pnl > 0 ? "+" : "") + eur(data.pnl) : ""), P, y + 42);
    y += 130;
  }

  // Courbe
  if (o.c) {
    const cx = P, cw = W - 2 * P, cy = y + 20, ch = 260;
    ctx.strokeStyle = COL.ligne; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy + ch / 2); ctx.lineTo(cx + cw, cy + ch / 2); ctx.stroke();
    const pts = (data.courbe || []).map((p) => Number(p.pct));
    if (pts.length >= 2) {
      const min = Math.min(0, ...pts), max = Math.max(0, ...pts);
      const span = max - min || 1;
      ctx.strokeStyle = COL.or; ctx.lineWidth = 5; ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach((v, i) => {
        const px = cx + (cw * i) / (pts.length - 1);
        const py = cy + ch - ((v - min) / span) * ch;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
    } else {
      ctx.fillStyle = COL.dim; ctx.font = "400 26px sans-serif";
      ctx.fillText("La course démarre aux premiers tickets réglés.", cx, cy + ch / 2 - 12);
    }
    y += ch + 80;
  }

  // Grille de stats détaillées
  if (o.s) {
    const cellW = (W - 2 * P - 24) / 2;
    const cells = [
      ["RÉUSSITE", pctReussite(data.reussite)],
      ["ROI", data.roi == null ? "—" : pct1(data.roi * 100)],
      ["TICKETS RÉGLÉS", String(data.regles ?? 0)],
      ["EN COURS", String(data.enCours ?? 0)],
    ];
    cells.forEach(([label, val], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = P + col * (cellW + 24);
      const cyy = y + row * 130;
      ctx.fillStyle = "rgba(255,255,255,.08)";
      rrect(ctx, x, cyy, cellW, 110, 18); ctx.fill();
      ctx.fillStyle = COL.dim; ctx.font = "700 22px sans-serif";
      ctx.fillText(label, x + 24, cyy + 42);
      ctx.fillStyle = "#fff"; ctx.font = "800 46px sans-serif";
      ctx.fillText(val, x + 24, cyy + 90);
    });
    y += 280;
  }

  // Pied de page
  ctx.fillStyle = COL.dim; ctx.font = "400 24px sans-serif";
  ctx.fillText("100 % CDM 2026 · classement entre amis", P, H - 56);
}
