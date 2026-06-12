"use client";

import {
  supabase, inscrireEmail, connecterEmail, deconnecter,
  demanderReinitMdp, changerMotDePasse,
  chargerMoi, sauverMoi, viderMesDonnees, listerJoueurs,
  sauverPreuve, lirePreuve, supprimerPreuve,
} from "../lib/supabase";
import { useState, useEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { dessinerCarte } from "../lib/carte";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell, PieChart, Pie,
} from "recharts";

const RESULTATS = ["En cours", "Gagné", "Perdu", "Remboursé"];
const PALETTE = ["#0E5A3C", "#B98E2F", "#1D4ED8", "#B42318", "#7C3AED", "#0E7490", "#C2410C", "#DB2777"];
const REGLES = [
  { titre: "100 % Coupe du monde", texte: "un ticket ne compte que si toutes ses sélections portent sur des matchs de la CDM 2026. Pas de tennis, pas de NBA, rien d'autre — y compris dans un combiné." },
  { titre: "Ticket avant le match", texte: "date, match, cote et mise se valident avant le coup d'envoi. Pas de pari rétroactif." },
  { titre: "Bankroll vérifiée", texte: "la bankroll de départ se déclare avec un screenshot du solde. La modifier exige une nouvelle preuve." },
  { titre: "Transparence totale", texte: "chaque inscrit peut ouvrir le carnet des autres : tickets, cotes, mises et résultats." },
  { titre: "Preuve obligatoire", texte: "tamponner Gagné ou Perdu exige un screenshot du ticket avec les sélections visibles, consultable par n'importe quel inscrit. Sans preuve, le ticket reste En cours." },
  { titre: "Combiné amputé", texte: "une sélection annulée ? Clique sur la cote du ticket et entre la nouvelle cote recalculée par le book. Le résultat, lui, se prouve." },
  { titre: "Remboursé", texte: "match annulé ou pari void : tampon Remboursé, P&L à zéro, pas de preuve exigée." },
  { titre: "Deux courses", texte: "classement au % de P&L (le juge de paix) et classement à la bankroll brute." },
  { titre: "Fair-play", texte: "tout repose sur la confiance et les preuves. Le premier qui triche paie sa tournée." },
];

const eur = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const eurSigne = (n) => (n > 0 ? "+" : "") + eur(n);
const pct = (n) => (n * 100).toFixed(1).replace(".", ",") + " %";
const pourcent = (v) => (v > 0 ? "+" : "") + v.toFixed(1).replace(".", ",") + " %";
const jjmm = (iso) => {
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
};
const aujourdhui = () => new Date().toLocaleDateString("fr-CA");
// Nombre saisi à la française : accepte la virgule comme séparateur décimal
const num = (v) => Number(String(v).trim().replace(",", "."));

const pnlDe = (b) => {
  const c = Number(b.cote), m = Number(b.mise);
  if (b.resultat === "Gagné") return Math.round(m * (c - 1) * 100) / 100;
  if (b.resultat === "Perdu") return -m;
  if (b.resultat === "Remboursé") return 0;
  return null;
};

function calcStats(paris, depart, recharges = []) {
  // Total investi = bankroll de départ + toutes les recharges (chacune prouvée)
  const totalRecharges = recharges.reduce((s, r) => s + Number(r.montant), 0);
  const investi = Math.round((depart + totalRecharges) * 100) / 100;
  const regles = paris.filter((b) => b.resultat !== "En cours");
  const chrono = [...regles].sort((a, b) =>
    a.date === b.date ? a.ts - b.ts : a.date.localeCompare(b.date)
  );
  const pnlTotal = Math.round(chrono.reduce((s, b) => s + pnlDe(b), 0) * 100) / 100;
  const miseTotale = chrono.reduce((s, b) => s + Number(b.mise), 0);
  const g = chrono.filter((b) => b.resultat === "Gagné").length;
  const p = chrono.filter((b) => b.resultat === "Perdu").length;
  const r = chrono.filter((b) => b.resultat === "Remboursé").length;

  // Courbe de bankroll : tickets réglés + recharges, en ordre chronologique
  const evenements = [
    ...chrono.map((b) => ({ date: b.date, ts: b.ts || 0, b })),
    ...recharges.map((re) => ({ date: re.date, ts: re.ts || 0, re })),
  ].sort((a, b) => (a.date === b.date ? a.ts - b.ts : a.date.localeCompare(b.date)));
  let bank = depart;
  const courbeBankroll = [{ name: "Départ", bankroll: depart }];
  const cumParJour = {}, totalParJour = {};
  let cum = 0;
  evenements.forEach((e) => {
    if (e.re) {
      bank = Math.round((bank + Number(e.re.montant)) * 100) / 100;
      courbeBankroll.push({ name: jjmm(e.date), bankroll: bank, match: "💶 Recharge (hors P&L)", p: Number(e.re.montant) });
      return;
    }
    const v = pnlDe(e.b);
    cum = Math.round((cum + v) * 100) / 100;
    bank = Math.round((bank + v) * 100) / 100;
    courbeBankroll.push({ name: jjmm(e.date), bankroll: bank, match: e.b.match, p: v });
    cumParJour[e.date] = cum;
    totalParJour[e.date] = Math.round(((totalParJour[e.date] || 0) + v) * 100) / 100;
  });
  const jours = Object.keys(totalParJour).sort();
  const parJour = jours.map((d) => ({ d: jjmm(d), total: totalParJour[d] }));
  const courbePct = jours.map((d) => ({
    d, pct: investi > 0 ? Math.round((cumParJour[d] / investi) * 1000) / 10 : 0,
  }));

  const gp = chrono.filter((b) => b.resultat === "Gagné" || b.resultat === "Perdu");
  let serieCourante = 0, serieType = null;
  for (let i = gp.length - 1; i >= 0; i--) {
    if (serieType === null) { serieType = gp[i].resultat; serieCourante = 1; }
    else if (gp[i].resultat === serieType) serieCourante++;
    else break;
  }
  let meilleureSerie = 0, serieTmp = 0;
  gp.forEach((b) => {
    if (b.resultat === "Gagné") { serieTmp++; if (serieTmp > meilleureSerie) meilleureSerie = serieTmp; }
    else serieTmp = 0;
  });
  let topCote = null;
  chrono.forEach((b) => {
    if (b.resultat === "Gagné" && (!topCote || Number(b.cote) > Number(topCote.cote))) topCote = b;
  });
  let meilleurJour = null;
  jours.forEach((d) => {
    if (!meilleurJour || totalParJour[d] > meilleurJour.total) meilleurJour = { d, total: totalParJour[d] };
  });

  return {
    pnlTotal, miseTotale, g, p, r, investi,
    reussite: g + p > 0 ? g / (g + p) : null,
    roi: miseTotale > 0 ? pnlTotal / miseTotale : null,
    pctVsDepart: investi > 0 ? Math.round((pnlTotal / investi) * 1000) / 10 : 0,
    actuelle: Math.round((investi + pnlTotal) * 100) / 100,
    enCours: paris.length - regles.length,
    regles: regles.length,
    last5: chrono.slice(-5).map((b) => b.resultat[0]),
    serieCourante, serieType, meilleureSerie,
    topCote: topCote ? { cote: topCote.cote, match: topCote.match } : null,
    meilleurJour,
    courbeBankroll, parJour, courbePct,
  };
}

// Chargement puis compression adaptative du screenshot (paliers jusqu'à passer sous la limite)
async function chargerImage(file) {
  // 1) Décodage direct en mémoire — aucune URL, donc aucun blocage de sécurité
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch (e) { /* plan B ci-dessous */ }
  }
  // 2) Plan B : lecture en data URL via FileReader
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("decode"));
    lecteur.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode"));
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(file);
  });
}

async function compresserAdaptatif(file) {
  const type = (file.type || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif")) throw new Error("heic");
  let img;
  try { img = await chargerImage(file); }
  catch (e) { throw new Error("decode"); }
  const essais = [[1000, 0.62], [820, 0.5], [660, 0.42], [520, 0.34], [420, 0.28], [340, 0.24]];
  let resultat = null;
  for (const [maxDim, q] of essais) {
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.width * ratio));
    cv.height = Math.max(1, Math.round(img.height * ratio));
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    resultat = cv.toDataURL("image/jpeg", q);
    if (resultat.length < 1400000) break;
  }
  if (img.close) { try { img.close(); } catch (e) {} }
  if (resultat && resultat.length < 2800000) return resultat;
  throw new Error("taille");
}

const traduireErreurAuth = (m) => {
  if (!m) return "Erreur inconnue. Réessaie.";
  if (m.includes("Invalid login credentials")) return "Email ou mot de passe incorrect.";
  if (m.includes("already registered")) return "Un compte existe déjà avec cet email — connecte-toi.";
  if (m.includes("Email not confirmed")) return "Confirme ton adresse via l'email reçu, puis connecte-toi.";
  if (m.toLowerCase().includes("rate limit")) return "Trop de tentatives — patiente une minute.";
  if (m.includes("at least 6 characters")) return "Mot de passe : 6 caractères minimum.";
  return m;
};

const messagePreuveErreur = (err, file) => {
  const ko = Math.round((file?.size || 0) / 1024);
  if (err.message === "heic") return `Photo HEIC non prise en charge (${ko} Ko). Fais une capture d'écran et envoie-la.`;
  if (err.message === "decode") return `Image illisible (${file?.type || "format inconnu"}, ${ko} Ko). Envoie une capture d'écran.`;
  if (err.message === "taille") return "Image impossible à réduire. Envoie une capture d'écran simple.";
  return "Erreur de préparation de l'image. Réessaie.";
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Archivo+Black&family=Space+Mono:wght@400;700&display=swap');
.cdm{
  --pelouse:#0E5A3C; --pelouse2:#0A4530; --craie:#F1F2EC; --ticket:#FFFFFF;
  --encre:#15241C; --dim:#6B7A70; --ligne:#D9DDD0; --or:#B98E2F;
  --gagne:#157A45; --perdu:#B42318; --attente:#A87E14; --remb:#5B6661;
  background:var(--craie); color:var(--encre);
  font-family:'Archivo',system-ui,sans-serif;
}
.cdm .disp{font-family:'Archivo Black','Archivo',sans-serif;}
.cdm .mono{font-family:'Space Mono',ui-monospace,monospace;}
.cdm input,.cdm select,.cdm button{font-family:inherit;}
.cdm input:focus-visible,.cdm select:focus-visible,.cdm button:focus-visible{
  outline:2px solid var(--pelouse); outline-offset:2px; border-radius:8px;
}
.cdm .panel{background:var(--ticket); border:1px solid var(--ligne); border-radius:16px;}
.cdm .champ{
  background:var(--ticket); border:1px solid var(--ligne); border-radius:10px;
  padding:8px 10px; font-size:14px; color:var(--encre); min-width:0;
}
.cdm .champ::placeholder{color:#9AA79E;}
.cdm .tab{
  font-family:'Archivo Black','Archivo',sans-serif; text-transform:uppercase;
  letter-spacing:1.5px; font-size:12px; padding:10px 16px; border-radius:12px;
  cursor:pointer; border:1px solid var(--ligne); background:var(--ticket); color:var(--dim);
}
.cdm .tab.actif{background:var(--pelouse); color:#fff; border-color:var(--pelouse2);}
.cdm .ticket{
  position:relative; background:var(--ticket); border:1px solid var(--ligne);
  border-radius:12px; display:grid; grid-template-columns:minmax(0,1fr) auto;
}
.cdm .stub{
  position:relative; border-left:2px dashed var(--ligne);
  display:flex; flex-direction:column; align-items:flex-end; justify-content:center;
  gap:6px; padding:10px 14px; min-width:118px;
}
.cdm .stub::before,.cdm .stub::after{
  content:""; position:absolute; left:-9px; width:16px; height:16px; border-radius:50%;
  background:var(--craie); border:1px solid var(--ligne);
}
.cdm .stub::before{top:-9px;} .cdm .stub::after{bottom:-9px;}
.cdm .stampwrap{position:relative; display:inline-block;}
.cdm .stampwrap::after{
  content:"▾"; position:absolute; right:7px; top:50%; transform:translateY(-50%);
  font-size:9px; pointer-events:none; opacity:.7;
}
.cdm .stamp{
  appearance:none; -webkit-appearance:none; cursor:pointer;
  font-family:'Space Mono',monospace; font-weight:700; font-size:11px;
  text-transform:uppercase; letter-spacing:1px;
  border:2px solid; border-radius:6px; padding:4px 20px 4px 9px; line-height:1.1;
}
.cdm .badge{
  display:inline-block; font-family:'Space Mono',monospace; font-weight:700; font-size:10px;
  text-transform:uppercase; letter-spacing:1px; border:2px solid; border-radius:6px;
  padding:3px 8px; line-height:1.1;
}
.cdm .st-att{color:var(--attente); border-color:var(--attente); background:#FBF3DD;}
.cdm .st-g{color:var(--gagne); border-color:var(--gagne); background:#E3F3E9; transform:rotate(-3deg);}
.cdm .st-p{color:var(--perdu); border-color:var(--perdu); background:#FBEAE7; transform:rotate(-3deg);}
.cdm .st-r{color:var(--remb); border-color:var(--remb); background:#EEF0ED; transform:rotate(-3deg);}
.cdm .badge.st-g,.cdm .badge.st-p,.cdm .badge.st-r{transform:none;}
.cdm .rang{display:flex; align-items:center; gap:10px; padding:10px 12px; border-top:1px solid var(--ligne); cursor:pointer; text-align:left; width:100%; background:none;}
.cdm .rang:hover{background:#F7F8F2;}
.cdm .rang.moi{background:#F4F8F2;}
.cdm .voile{position:fixed; inset:0; background:rgba(21,36,28,.55); z-index:50;
  display:flex; align-items:center; justify-content:center; padding:16px;}
.cdm .titre-app{font-size:24px; letter-spacing:1px; line-height:1.15;}
.cdm .champ-mini{padding:2px 6px; font-size:11px; width:76px;}
.cdm .ch-date{font-size:12px;}
.cdm .ch-match{flex:1 1 170px; min-width:0;}
.cdm .ch-cote{width:86px;}
.cdm .ch-mise{width:92px;}
@media (max-width:640px){
  .cdm .champ{font-size:16px; padding:10px 12px;}
  .cdm .champ-mini{font-size:16px; padding:4px 8px; width:96px;}
  .cdm .ch-date{flex:1 1 100%; font-size:16px;}
  .cdm .ch-match{flex:1 1 100%;}
  .cdm .ch-cote,.cdm .ch-mise{flex:1 1 40%; width:auto;}
  .cdm .btn-valider{flex:1 1 100%; padding:12px;}
  .cdm .titre-app{font-size:20px;}
  .cdm .stamp{font-size:12px; padding:7px 22px 7px 10px;}
  .cdm .badge{font-size:11px; padding:5px 9px;}
  .cdm .stub{min-width:104px; padding:10px 10px;}
  .cdm .forme-rang{display:none;}
  .cdm .tab{flex:1 1 0; text-align:center; padding:12px 8px;}
}
@media (prefers-reduced-motion:no-preference){
  .cdm .ticket{transition:transform .12s ease;}
  .cdm .ticket:hover{transform:translateY(-1px);}
}
`;

function Titre({ children }) {
  return (
    <div className="disp uppercase mb-2" style={{ fontSize: 11, letterSpacing: 2, color: "var(--dim)" }}>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className="panel p-3">
      <div className="mono uppercase" style={{ fontSize: 10, letterSpacing: 1.5, color: "var(--dim)" }}>{label}</div>
      <div className="mono font-bold mt-1" style={{ fontSize: 17, color: color || "var(--encre)" }}>{value}</div>
      {sub && <div className="mono mt-0.5" style={{ fontSize: 10, color: "var(--dim)" }}>{sub}</div>}
    </div>
  );
}

function Forme({ last5 }) {
  if (!last5?.length) return <span className="mono" style={{ fontSize: 9, color: "var(--dim)" }}>—</span>;
  return (
    <span className="flex items-center gap-1" aria-label="Cinq derniers résultats">
      {last5.map((x, i) => (
        <span key={i} title={x === "G" ? "Gagné" : x === "P" ? "Perdu" : "Remboursé"} style={{
          width: 8, height: 8, borderRadius: 99,
          background: x === "G" ? "var(--gagne)" : x === "P" ? "var(--perdu)" : "var(--remb)",
        }} />
      ))}
    </span>
  );
}

function BulleBankroll({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="panel px-3 py-2 mono" style={{ fontSize: 11 }}>
      <div className="font-bold">{d.name}</div>
      {d.match && <div style={{ color: "var(--dim)" }}>{d.match}</div>}
      {d.p != null && <div style={{ color: d.p >= 0 ? "var(--gagne)" : "var(--perdu)" }}>{eurSigne(d.p)}</div>}
      <div>Bankroll : {eur(d.bankroll)}</div>
    </div>
  );
}

function BulleJour({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="panel px-3 py-2 mono" style={{ fontSize: 11 }}>
      <div className="font-bold">{label}</div>
      <div style={{ color: v >= 0 ? "var(--gagne)" : "var(--perdu)" }}>{eurSigne(v)}</div>
    </div>
  );
}

function BulleCourse({ active, payload, label, joueurs }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel px-3 py-2 mono" style={{ fontSize: 11 }}>
      <div className="font-bold mb-1">{jjmm(label)}</div>
      {[...payload].sort((a, b) => b.value - a.value).map((e) => {
        const j = joueurs.find((x) => x.cle === e.dataKey);
        return (
          <div key={e.dataKey} className="flex items-center gap-1.5">
            <span style={{ width: 7, height: 7, borderRadius: 99, background: e.color }} />
            <span>{j?.pseudo || e.dataKey}</span>
            <span className="font-bold" style={{ color: e.value >= 0 ? "var(--gagne)" : "var(--perdu)" }}>
              {pourcent(e.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function CarnetParis() {
  const [chargement, setChargement] = useState(true);
  const [sansStockage, setSansStockage] = useState(false);
  const [utilisateur, setUtilisateur] = useState(null); // { id, email }
  const [authMode, setAuthMode] = useState("creation"); // creation | connexion
  const [emailInput, setEmailInput] = useState("");
  const [mdpInput, setMdpInput] = useState("");
  const [mdpVisible, setMdpVisible] = useState(false);
  const [authErreur, setAuthErreur] = useState(null);
  const [authInfo, setAuthInfo] = useState(null);
  const [authEnCours, setAuthEnCours] = useState(false);
  const [recuperation, setRecuperation] = useState(false); // lien « mot de passe oublié » cliqué
  const [nouveauMdp, setNouveauMdp] = useState("");
  const [errRecup, setErrRecup] = useState(null);
  const [recupEnCours, setRecupEnCours] = useState(false);
  const [rappels, setRappels] = useState("inconnu"); // inconnu | dispo | actifs | indispo
  const [rappelsMsg, setRappelsMsg] = useState(null);
  const [surIOS, setSurIOS] = useState(false);
  const [installee, setInstallee] = useState(true); // app sur l'écran d'accueil (requis sur iOS seulement)
  const [installPrompt, setInstallPrompt] = useState(null); // invite d'installation (Android/desktop)
  const [rappelsPlusTard, setRappelsPlusTard] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(false);
  const [tentative, setTentative] = useState(0);
  const [errPseudo, setErrPseudo] = useState(null);
  const [profil, setProfil] = useState(null); // { pseudo, cle }
  const [pseudoInput, setPseudoInput] = useState("");
  const [reglesVues, setReglesVues] = useState(false);
  const [departVerifie, setDepartVerifie] = useState(false);
  const [modifBank, setModifBank] = useState(false);
  const [departInput, setDepartInput] = useState("");
  const [envoiBank, setEnvoiBank] = useState(false);
  const [errBank, setErrBank] = useState(null);
  const [depart, setDepart] = useState(200);
  const [recharges, setRecharges] = useState([]); // [{ id, ts, date, montant }]
  const [rechargeOuvert, setRechargeOuvert] = useState(false);
  const [rechargeMontant, setRechargeMontant] = useState("");
  const [envoiRecharge, setEnvoiRecharge] = useState(false);
  const [errRecharge, setErrRecharge] = useState(null);
  const [paris, setParis] = useState([]);
  const [form, setForm] = useState({ date: aujourdhui(), match: "", cote: "", mise: "" });
  const [confirmSuppr, setConfirmSuppr] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [editionCote, setEditionCote] = useState(null);
  const [onglet, setOnglet] = useState("carnet");
  const [apercuFinale, setApercuFinale] = useState(false);
  const [classement, setClassement] = useState([]);
  const [majClassement, setMajClassement] = useState(false);
  const [preuveEnAttente, setPreuveEnAttente] = useState(null); // { id, resultat }
  const [envoiPreuve, setEnvoiPreuve] = useState(false);
  const [errPreuve, setErrPreuve] = useState(null);
  const [envoiTicket, setEnvoiTicket] = useState(null); // id du ticket dont la preuve s'envoie
  const [errTicket, setErrTicket] = useState(null);
  const [preuveVue, setPreuveVue] = useState(null); // { titre, image|null, erreur? }
  const [joueurVu, setJoueurVu] = useState(null); // cle du joueur consulté
  const [partageOuvert, setPartageOuvert] = useState(false);
  const [partageOpts, setPartageOpts] = useState({ n: true, m: true, p: true, c: true, s: true });
  const [lienPartage, setLienPartage] = useState(null);
  const [qrPartage, setQrPartage] = useState(null);
  const [lienCopie, setLienCopie] = useState(false);
  const apercuRef = useRef(null);

  // Au retour d'un joueur déjà inscrit, on présente « Se connecter » plutôt
  // que « Créer mon compte » (évite les doublons de compte par mégarde).
  useEffect(() => {
    try {
      if (localStorage.getItem("cdm_compte_existant") === "1") setAuthMode("connexion");
    } catch (e) { /* stockage indisponible */ }
  }, []);

  useEffect(() => {
    if (!supabase) { setSansStockage(true); setChargement(false); return; }
    let actif = true;
    const appliquer = (session) => {
      if (!actif) return;
      const u = session?.user ? { id: session.user.id, email: session.user.email } : null;
      if (u) { try { localStorage.setItem("cdm_compte_existant", "1"); } catch (e) {} }
      setUtilisateur((prev) => (prev?.id === u?.id ? prev : u));
    };
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { appliquer(null); return; }
      // Vérifie que le compte existe toujours côté serveur (ex. doublon
      // supprimé dans le dashboard) — sinon on purge la session locale.
      const { error } = await supabase.auth.getUser();
      if (error) {
        try { await supabase.auth.signOut(); } catch (e) {}
        appliquer(null);
        return;
      }
      appliquer(data.session);
    });
    const { data: ecoute } = supabase.auth.onAuthStateChange((evenement, session) => {
      if (evenement === "PASSWORD_RECOVERY") setRecuperation(true);
      appliquer(session);
    });
    return () => { actif = false; ecoute.subscription.unsubscribe(); };
  }, []);

  // Service worker (PWA + rappels) et état des notifications
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (!("PushManager" in window) || !("Notification" in window) || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      setRappels("indispo");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((abo) => setRappels(abo ? "actifs" : "dispo"))
      .catch(() => setRappels("dispo"));
  }, []);

  // Détection de l'appareil pour l'étape « rappels obligatoires »
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { setRappelsPlusTard(sessionStorage.getItem("cdm_rappels_plus_tard") === "1"); }
    catch (e) { setRappelsPlusTard(false); }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setSurIOS(ios);
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone || false;
    // Hors iOS, les notifications marchent sans installer : seul iOS exige l'app sur l'écran d'accueil
    setInstallee(standalone || !ios);
    const surInvite = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", surInvite);
    return () => window.removeEventListener("beforeinstallprompt", surInvite);
  }, []);

  const passerRappels = () => {
    try { sessionStorage.setItem("cdm_rappels_plus_tard", "1"); } catch (e) {}
    setRappelsPlusTard(true);
  };

  const [installPlusTard, setInstallPlusTard] = useState(true);
  useEffect(() => {
    try { setInstallPlusTard(sessionStorage.getItem("cdm_install_plus_tard") === "1"); }
    catch (e) { setInstallPlusTard(false); }
  }, []);
  const passerInstall = () => {
    try { sessionStorage.setItem("cdm_install_plus_tard", "1"); } catch (e) {}
    setInstallPlusTard(true);
  };

  useEffect(() => {
    if (!supabase) return;
    if (!utilisateur) {
      setChargement(false); setProfil(null); setParis([]); setDepart(200);
      setRecharges([]); setRechargeOuvert(false);
      setReglesVues(false); setDepartVerifie(false); setClassement([]);
      setErreurChargement(false);
      return;
    }
    let actif = true;
    setChargement(true); setErreurChargement(false);
    (async () => {
      let moi = null, ok = false;
      for (let essai = 0; essai < 3 && !ok; essai++) {
        try { moi = await chargerMoi(); ok = true; }
        catch (e) { await new Promise((r) => setTimeout(r, 700)); }
      }
      if (!actif) return;
      if (!ok) { setErreurChargement(true); setChargement(false); return; }
      if (moi) {
        setProfil({ pseudo: moi.pseudo, cle: utilisateur.id });
        const d = moi.donnees || {};
        if (typeof d.depart === "number") setDepart(d.depart);
        setParis(Array.isArray(d.paris) ? d.paris : []);
        setRecharges(Array.isArray(d.recharges) ? d.recharges : []);
        setReglesVues(!!d.reglesVues);
        setDepartVerifie(!!d.departVerifie);
      } else {
        setProfil(null);
      }
      setChargement(false);
    })();
    return () => { actif = false; };
  }, [utilisateur, tentative]);

  // Sauvegarde du carnet + publication de l'entrée de classement (Supabase)
  useEffect(() => {
    if (chargement || sansStockage || !utilisateur || !profil) return;
    const t = setTimeout(() => {
      const s = calcStats(paris, depart, recharges);
      const entree = {
        pseudo: profil.pseudo, depart, departVerifie, bankroll: s.actuelle, pnl: s.pnlTotal,
        pnlPct: s.pctVsDepart, roi: s.roi, regles: s.regles, enCours: s.enCours,
        investi: s.investi,
        recharges: recharges.map(({ id, ts, date, montant }) => ({ id, ts, date, montant })),
        reussite: s.reussite, last5: s.last5, courbe: s.courbePct, maj: Date.now(),
        paris: paris.map(({ id, ts, date, match, cote, mise, resultat, preuve, preuveTicket }) =>
          ({ id, ts, date, match, cote, mise, resultat, preuve: !!preuve, preuveTicket: !!preuveTicket })),
      };
      sauverMoi(profil.pseudo, { depart, paris, reglesVues, departVerifie, recharges }, entree).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [depart, paris, recharges, profil, reglesVues, departVerifie, chargement, sansStockage, utilisateur]);

  useEffect(() => {
    if (confirmSuppr == null) return;
    const t = setTimeout(() => setConfirmSuppr(null), 2500);
    return () => clearTimeout(t);
  }, [confirmSuppr]);

  useEffect(() => {
    if (!chargement && profil && reglesVues && !departVerifie && departInput === "" && depart > 0) {
      setDepartInput(String(depart).replace(".", ","));
    }
  }, [chargement, profil, reglesVues, departVerifie]);

  const chargerClassement = async () => {
    if (!supabase || !utilisateur) return;
    setMajClassement(true);
    try {
      const lignes = await listerJoueurs();
      setClassement(
        lignes
          .map((l) => ({ ...(l.entree || {}), pseudo: l.pseudo, cle: l.id }))
          .sort((a, b) => a.cle.localeCompare(b.cle))
      );
    } catch (e) { /* classement vide */ }
    setMajClassement(false);
  };

  useEffect(() => { if (!chargement && profil) chargerClassement(); }, [chargement, profil]);
  useEffect(() => { if (onglet === "classement" || onglet === "finale") chargerClassement(); }, [onglet]);

  const stats = useMemo(() => calcStats(paris, depart, recharges), [paris, depart, recharges]);

  const joueurs = useMemo(() => {
    const mesParisPartages = paris.map(({ id, ts, date, match, cote, mise, resultat, preuve, preuveTicket }) =>
      ({ id, ts, date, match, cote, mise, resultat, preuve: !!preuve, preuveTicket: !!preuveTicket }));
    const moi = profil ? {
      pseudo: profil.pseudo, cle: profil.cle, depart, departVerifie, bankroll: stats.actuelle,
      pnl: stats.pnlTotal, pnlPct: stats.pctVsDepart, reussite: stats.reussite,
      investi: stats.investi,
      recharges: recharges.map(({ id, ts, date, montant }) => ({ id, ts, date, montant })),
      last5: stats.last5, courbe: stats.courbePct, regles: stats.regles, paris: mesParisPartages,
    } : null;
    const base = classement.map((e) => (moi && e.cle === moi.cle ? { ...e, ...moi } : e));
    if (moi && !base.some((e) => e.cle === moi.cle)) {
      base.push(moi);
      base.sort((a, b) => a.cle.localeCompare(b.cle));
    }
    return base.map((e, i) => ({ ...e, color: PALETTE[i % PALETTE.length] }));
  }, [classement, profil, stats, depart, paris, recharges]);

  const course = useMemo(() => {
    const dates = [...new Set(joueurs.flatMap((e) => (e.courbe || []).map((p) => p.d)))].sort();
    const data = dates.map((d) => ({ d }));
    joueurs.forEach((e) => {
      let cur = 0;
      const map = Object.fromEntries((e.courbe || []).map((p) => [p.d, p.pct]));
      dates.forEach((d, i) => { if (map[d] != null) cur = map[d]; data[i][e.cle] = cur; });
    });
    return data;
  }, [joueurs]);

  const formValide = form.match.trim() && num(form.cote) > 1 && num(form.mise) > 0;

  const ajouter = () => {
    if (!formValide) return;
    setParis((prev) => [...prev, {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      date: form.date || aujourdhui(),
      match: form.match.trim(),
      cote: Math.round(num(form.cote) * 100) / 100,
      mise: Math.round(num(form.mise) * 100) / 100,
      resultat: "En cours",
      preuve: false,
      preuveTicket: false,
    }]);
    setForm({ date: form.date, match: "", cote: "", mise: form.mise });
  };

  const tamponner = (id, resultat, preuve) =>
    setParis((prev) => prev.map((b) => (b.id === id ? { ...b, resultat, ...(preuve !== undefined ? { preuve } : {}) } : b)));

  const choisirResultat = (b, valeur) => {
    setErrPreuve(null);
    if (valeur === b.resultat) return;
    if (valeur === "Gagné" || valeur === "Perdu") {
      setPreuveEnAttente({ id: b.id, resultat: valeur });
    } else if (valeur === "En cours") {
      tamponner(b.id, "En cours", false);
      setPreuveEnAttente(null);
      if (profil) supprimerPreuve(b.id).catch(() => {});
    } else {
      tamponner(b.id, valeur); // Remboursé, sans preuve
      setPreuveEnAttente(null);
    }
  };

  const envoyerPreuve = async (file) => {
    if (!preuveEnAttente || !profil) return;
    setEnvoiPreuve(true); setErrPreuve(null);
    let image;
    try { image = await compresserAdaptatif(file); }
    catch (err) {
      setErrPreuve(messagePreuveErreur(err, file));
      setEnvoiPreuve(false); return;
    }
    try {
      await sauverPreuve(preuveEnAttente.id, image);
      tamponner(preuveEnAttente.id, preuveEnAttente.resultat, true);
      setPreuveEnAttente(null);
    } catch (e) {
      setErrPreuve("Échec de l'envoi côté stockage : " + (e?.message || "erreur inconnue") + ". Réessaie dans quelques secondes.");
    }
    setEnvoiPreuve(false);
  };

  // Ajout/remplacement d'un screenshot : type "ticket" (avant match) ou "resultat" (validation)
  const envoyerScreen = async (b, type, file) => {
    if (!profil) return;
    const busy = b.id + (type === "ticket" ? ":tic" : ":res");
    const ref = type === "ticket" ? b.id + ":ticket" : b.id;
    const champ = type === "ticket" ? "preuveTicket" : "preuve";
    setEnvoiTicket(busy); setErrTicket(null);
    let image;
    try { image = await compresserAdaptatif(file); }
    catch (err) {
      setErrTicket(messagePreuveErreur(err, file));
      setEnvoiTicket(null); return;
    }
    try {
      await sauverPreuve(ref, image);
      setParis((prev) => prev.map((x) => (x.id === b.id ? { ...x, [champ]: true } : x)));
    } catch (e) {
      setErrTicket("Échec de l'envoi côté stockage : " + (e?.message || "erreur inconnue") + ". Réessaie.");
    }
    setEnvoiTicket(null);
  };

  const validerBankroll = async (file) => {
    const montant = Number(String(departInput).trim().replace(",", "."));
    if (!Number.isFinite(montant) || montant <= 0) { setErrBank("Montant invalide."); return; }
    setEnvoiBank(true); setErrBank(null);
    let image;
    try { image = await compresserAdaptatif(file); }
    catch (err) {
      setErrBank(messagePreuveErreur(err, file));
      setEnvoiBank(false); return;
    }
    try {
      await sauverPreuve("bankroll", image);
      setDepart(Math.round(montant * 100) / 100);
      setDepartVerifie(true);
      setModifBank(false);
    } catch (e) {
      setErrBank("Échec de l'envoi côté stockage : " + (e?.message || "erreur inconnue") + ". Réessaie dans quelques secondes.");
    }
    setEnvoiBank(false);
  };

  const validerRecharge = async (file) => {
    const montant = Number(String(rechargeMontant).trim().replace(",", "."));
    if (!Number.isFinite(montant) || montant <= 0) { setErrRecharge("Montant invalide."); return; }
    setEnvoiRecharge(true); setErrRecharge(null);
    let image;
    try { image = await compresserAdaptatif(file); }
    catch (err) {
      setErrRecharge(messagePreuveErreur(err, file));
      setEnvoiRecharge(false); return;
    }
    const rech = {
      id: "rech-" + Date.now(), ts: Date.now(), date: aujourdhui(),
      montant: Math.round(montant * 100) / 100,
    };
    try {
      await sauverPreuve(rech.id, image);
      setRecharges((prev) => [...prev, rech]);
      setRechargeMontant(""); setRechargeOuvert(false);
    } catch (e) {
      setErrRecharge("Échec de l'envoi côté stockage : " + (e?.message || "erreur inconnue") + ". Réessaie dans quelques secondes.");
    }
    setEnvoiRecharge(false);
  };

  const voirPreuve = async (cleJoueur, b) => {
    setPreuveVue({ titre: `${b.match} — ${b.resultat}`, image: null });
    try {
      const image = await lirePreuve(cleJoueur, b.id);
      if (image) setPreuveVue({ titre: `${b.match} — ${b.resultat}`, image });
      else throw new Error();
    } catch (e) {
      setPreuveVue({ titre: `${b.match} — ${b.resultat}`, image: null, erreur: true });
    }
  };

  const changerCote = () => {
    if (!editionCote) return;
    const v = Number(String(editionCote.valeur).trim().replace(",", "."));
    if (Number.isFinite(v) && v >= 1) {
      const arrondie = Math.round(v * 100) / 100;
      setParis((prev) => prev.map((b) => (b.id === editionCote.id ? { ...b, cote: arrondie } : b)));
    }
    setEditionCote(null);
  };

  const supprimer = (id) => {
    if (confirmSuppr !== id) { setConfirmSuppr(id); return; }
    setParis((prev) => prev.filter((b) => b.id !== id));
    setConfirmSuppr(null);
    if (profil) {
      supprimerPreuve(id).catch(() => {});
      supprimerPreuve(id + ":ticket").catch(() => {});
    }
  };

  const inscrire = async () => {
    const pseudo = pseudoInput.trim().slice(0, 16);
    if (pseudo.length < 2 || !utilisateur) return;
    setErrPseudo(null);
    let existant = null;
    try {
      existant = await chargerMoi();
    } catch (e) {
      setErrPseudo("Connexion instable — impossible de vérifier ton profil. Réessaie dans quelques secondes.");
      return;
    }
    if (existant) {
      // Un carnet existe déjà pour ce compte : on le restaure au lieu de l'écraser
      setProfil({ pseudo: existant.pseudo, cle: utilisateur.id });
      const d = existant.donnees || {};
      if (typeof d.depart === "number") setDepart(d.depart);
      setParis(Array.isArray(d.paris) ? d.paris : []);
      setRecharges(Array.isArray(d.recharges) ? d.recharges : []);
      setReglesVues(!!d.reglesVues);
      setDepartVerifie(!!d.departVerifie);
      return;
    }
    setProfil({ pseudo, cle: utilisateur.id });
  };

  const activerRappels = async () => {
    setRappelsMsg(null);
    const surIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const installee = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone;
    if (surIOS && !installee) {
      setRappelsMsg("Sur iPhone, installe d'abord l'app : bouton Partager → « Sur l'écran d'accueil », puis active les rappels depuis l'app installée.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setRappelsMsg("Notifications refusées — tu peux les réautoriser dans les réglages du navigateur.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const clePublique = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const brut = atob(clePublique.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(clePublique.length / 4) * 4, "="));
      const cle = new Uint8Array([...brut].map((c) => c.charCodeAt(0)));
      const abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(abo.toJSON()),
      });
      if (!r.ok) throw new Error("enregistrement");
      setRappels("actifs");
      setRappelsMsg("Rappels activés : tous les jours à 10h et 22h 🔔");
    } catch (e) {
      setRappelsMsg("Activation impossible (" + (e?.message || "erreur") + "). Réessaie.");
    }
  };

  const motDePasseOublie = async () => {
    const email = emailInput.trim();
    if (!email.includes("@")) {
      setAuthErreur("Entre d'abord ton email ci-dessus, puis re-clique sur « mot de passe oublié ».");
      return;
    }
    setAuthEnCours(true); setAuthErreur(null); setAuthInfo(null);
    try {
      await demanderReinitMdp(email);
      setAuthInfo("Email envoyé à " + email + " — clique sur le lien reçu pour choisir un nouveau mot de passe (pense aux spams).");
    } catch (e) {
      setAuthErreur(traduireErreurAuth(e?.message));
    }
    setAuthEnCours(false);
  };

  const validerNouveauMdp = async () => {
    const mdp = nouveauMdp.trim();
    if (mdp.length < 6) { setErrRecup("Mot de passe : 6 caractères minimum."); return; }
    setRecupEnCours(true); setErrRecup(null);
    try {
      await changerMotDePasse(mdp);
      setRecuperation(false); setNouveauMdp("");
    } catch (e) {
      setErrRecup(traduireErreurAuth(e?.message));
    }
    setRecupEnCours(false);
  };

  const validerAuth = async () => {
    const email = emailInput.trim();
    const mdp = mdpInput.trim(); // espaces parasites du clavier mobile
    if (!email.includes("@") || mdp.length < 6) {
      setAuthErreur("Email valide et mot de passe de 6 caractères minimum.");
      return;
    }
    setAuthEnCours(true); setAuthErreur(null); setAuthInfo(null);
    try {
      if (authMode === "creation") {
        const r = await inscrireEmail(email, mdp);
        if (!r?.session) setAuthInfo("Compte créé — confirme ton adresse via l'email reçu, puis connecte-toi.");
      } else {
        await connecterEmail(email, mdp);
      }
    } catch (e) {
      setAuthErreur(traduireErreurAuth(e?.message));
      // L'email est déjà pris : on bascule sur l'écran de connexion.
      if ((e?.message || "").includes("already registered")) setAuthMode("connexion");
    }
    setAuthEnCours(false);
  };

  const toutEffacer = async () => {
    if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 3000); return; }
    try { await viderMesDonnees(); } catch (e) {}
    setParis([]); setDepart(200); setProfil(null); setPseudoInput(""); setReglesVues(false);
    setRecharges([]); setRechargeOuvert(false); setRechargeMontant(""); setErrRecharge(null);
    setDepartVerifie(false); setModifBank(false); setDepartInput(""); setErrBank(null);
    setClassement([]); setConfirmReset(false); setOnglet("carnet"); setJoueurVu(null);
  };

  const stampClasse = (r) =>
    r === "Gagné" ? "st-g" : r === "Perdu" ? "st-p" : r === "Remboursé" ? "st-r" : "st-att";

  // Contrôle screenshot dans un ticket : voir + modifier si présent, sinon ajouter
  const lienVert = { background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--pelouse)", fontSize: "inherit", textDecoration: "underline" };
  const lienGris = (busy) => ({ cursor: busy ? "wait" : "pointer", color: "var(--dim)", textDecoration: "underline dotted", textUnderlineOffset: 2, fontSize: "inherit" });
  const ctrlScreen = (busyKey, present, viewLabel, addLabel, onView, type, b) => {
    const busy = envoiTicket === busyKey;
    const champFile = (
      <input type="file" accept="image/*" style={{ display: "none" }} disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) envoyerScreen(b, type, f); e.target.value = ""; }} />
    );
    return present ? (
      <>
        <button onClick={onView} className="mono" style={lienVert}>{viewLabel}</button>
        <label className="mono" style={lienGris(busy)}>{busy ? "envoi…" : "modifier"}{champFile}</label>
      </>
    ) : (
      <label className="mono" style={lienGris(busy)}>{busy ? "envoi…" : addLabel}{champFile}</label>
    );
  };

  const tries = [...paris].sort((a, b) =>
    a.date === b.date ? b.ts - a.ts : b.date.localeCompare(a.date)
  );

  const donut = [
    { name: "Gagnés", value: stats.g, color: "var(--gagne)" },
    { name: "Perdus", value: stats.p, color: "var(--perdu)" },
    { name: "Remboursés", value: stats.r, color: "var(--remb)" },
  ].filter((x) => x.value > 0);

  const joueurOuvert = joueurVu ? joueurs.find((j) => j.cle === joueurVu) : null;

  // ----- Partage de la carte de stats -----
  const partageData = useMemo(() => ({
    pseudo: profil?.pseudo,
    bankroll: stats.actuelle, depart, investi: stats.investi,
    pnl: stats.pnlTotal, pnlPct: stats.pctVsDepart, roi: stats.roi,
    reussite: stats.reussite, regles: stats.regles, enCours: stats.enCours,
    last5: stats.last5, courbe: stats.courbePct,
  }), [profil, stats, depart]);

  useEffect(() => {
    if (partageOuvert && apercuRef.current) {
      dessinerCarte(apercuRef.current, partageData, partageOpts);
    }
  }, [partageOuvert, partageData, partageOpts]);

  const lienCarte = () => {
    if (typeof window === "undefined" || !profil) return "";
    const q = Object.entries(partageOpts).filter(([, v]) => !v).map(([k]) => k + "=0").join("&");
    return window.location.origin + "/u/" + profil.cle + (q ? "?" + q : "");
  };

  const partagerImage = async () => {
    const canvas = apercuRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const fichier = new File([blob], "stats-cdm.png", { type: "image/png" });
      const lien = lienCarte();
      try {
        if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
          await navigator.share({
            files: [fichier], title: "Mes stats — Journal CDM 2026",
            text: "Mon carnet de paris CDM 2026 ⚽ " + lien,
          });
          return;
        }
      } catch (e) { if (e?.name === "AbortError") return; }
      // Repli : téléchargement
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "stats-cdm.png";
      a.click();
    }, "image/png");
  };

  const genererLienQR = async () => {
    const lien = lienCarte();
    setLienPartage(lien);
    setLienCopie(false);
    try { setQrPartage(await QRCode.toDataURL(lien, { width: 320, margin: 2, color: { dark: "#15241C", light: "#FFFFFF" } })); }
    catch (e) { setQrPartage(null); }
  };

  const copierLien = async () => {
    try { await navigator.clipboard.writeText(lienPartage); setLienCopie(true); setTimeout(() => setLienCopie(false), 2000); }
    catch (e) {}
  };

  const basculerOpt = (k) => { setPartageOpts((o) => ({ ...o, [k]: !o[k] })); setLienPartage(null); setQrPartage(null); };

  const tournoisFini = aujourdhui() > "2026-07-19";
  const joursRestants = Math.max(0, Math.ceil((new Date("2026-07-19T23:59:00") - new Date()) / 86400000));
  const podium = [...joueurs].sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));

  if (chargement) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center">
        <style>{CSS}</style>
        <div className="mono" style={{ color: "var(--dim)" }}>Ouverture du carnet…</div>
      </div>
    );
  }

  // ---------- Configuration manquante ----------
  if (!supabase) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 430 }}>
          <div className="disp uppercase" style={{ fontSize: 20 }}>Configuration manquante</div>
          <p className="mono mt-3" style={{ fontSize: 11, color: "var(--dim)", lineHeight: 1.7 }}>
            Ajoute NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans les
            variables d'environnement Vercel, puis redéploie (voir README).
          </p>
        </div>
      </div>
    );
  }

  // ---------- iPhone via Safari : installer l'app AVANT de créer le compte ----------
  // (l'app installée a ses propres données : créer le compte dedans évite une double connexion)
  if (surIOS && !installee && !installPlusTard && !recuperation) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4 py-6">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 430 }}>
          <div className="mono uppercase mb-2" style={{ fontSize: 9, letterSpacing: 2, color: "var(--or)" }}>
            Avant de commencer
          </div>
          <div className="disp uppercase" style={{ fontSize: 24, lineHeight: 1.2 }}>
            Journal CDM 2026
          </div>
          <p className="mt-4" style={{ fontSize: 14, lineHeight: 1.6 }}>
            Installe d'abord l'app sur ton écran d'accueil : tu auras l'icône ⚽, les rappels
            quotidiens, et tu ne feras ton compte qu'<b>une seule fois</b>.
          </p>
          <div className="mt-4 rounded-xl p-4" style={{ background: "var(--craie)", border: "1px solid var(--ligne)" }}>
            <ol style={{ fontSize: 14, lineHeight: 2, paddingLeft: 18, margin: 0 }}>
              <li>Touche <b>Partager</b> (carré avec flèche ⬆️, en bas)</li>
              <li>Choisis <b>« Sur l'écran d'accueil »</b></li>
              <li>Ouvre l'app depuis l'icône ⚽ et crée ton compte dedans</li>
            </ol>
          </div>
          <button onClick={passerInstall} className="mono mt-5"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: 10, textDecoration: "underline" }}>
            Continuer dans Safari quand même (tu devras te reconnecter dans l'app plus tard)
          </button>
        </div>
      </div>
    );
  }

  // ---------- Écran compte (email) ----------
  if (!utilisateur) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4 py-6">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 430 }}
          onKeyDown={(e) => { if (e.key === "Enter") validerAuth(); }}>
          <div className="mono uppercase mb-2" style={{ fontSize: 9, letterSpacing: 2, color: "var(--or)" }}>
            Étape 1/4 · Compte
          </div>
          <div className="disp uppercase" style={{ fontSize: 24, lineHeight: 1.2 }}>
            Journal CDM 2026
          </div>
          <div className="mono mt-2" style={{ fontSize: 11, color: "var(--dim)" }}>
            11 juin → 19 juillet · 104 matchs
          </div>
          <p className="mt-4" style={{ fontSize: 14, lineHeight: 1.5 }}>
            {authMode === "creation"
              ? "Crée ton compte : il te permet de retrouver ton carnet sur n'importe quel appareil."
              : "Connecte-toi pour retrouver ton carnet."}
          </p>
          <div className="flex flex-col gap-2 mt-4">
            <input type="email" autoComplete="email" inputMode="email"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="Email" value={emailInput} aria-label="Email"
              onChange={(e) => setEmailInput(e.target.value)} className="champ" autoFocus />
            <div className="flex gap-2">
              <input type={mdpVisible ? "text" : "password"}
                autoComplete={authMode === "creation" ? "new-password" : "current-password"}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder="Mot de passe (6 caractères min.)" value={mdpInput} aria-label="Mot de passe"
                onChange={(e) => setMdpInput(e.target.value)} className="champ flex-1" />
              <button onClick={() => setMdpVisible((v) => !v)} type="button"
                aria-label={mdpVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                title={mdpVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                className="champ" style={{ cursor: "pointer", flexShrink: 0 }}>
                {mdpVisible ? "🙈" : "👁️"}
              </button>
            </div>
          </div>
          <button onClick={validerAuth} disabled={authEnCours}
            className="rounded-lg px-4 py-3 font-semibold w-full mt-4"
            style={{
              background: "var(--pelouse)", color: "#fff", fontSize: 14,
              border: "1px solid var(--pelouse2)",
              cursor: authEnCours ? "wait" : "pointer", opacity: authEnCours ? 0.6 : 1,
            }}>
            {authEnCours ? "Un instant…" : authMode === "creation" ? "Créer mon compte" : "Se connecter"}
          </button>
          {authErreur && <p className="mono mt-2" style={{ fontSize: 10, color: "var(--perdu)" }}>{authErreur}</p>}
          {authInfo && <p className="mono mt-2" style={{ fontSize: 10, color: "var(--gagne)" }}>{authInfo}</p>}
          <div className="flex flex-col gap-2 mt-4">
            <button onClick={() => { setAuthMode(authMode === "creation" ? "connexion" : "creation"); setAuthErreur(null); setAuthInfo(null); }}
              className="mono text-left"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: 11, textDecoration: "underline" }}>
              {authMode === "creation" ? "J'ai déjà un compte — me connecter" : "Pas encore de compte — en créer un"}
            </button>
            {authMode === "connexion" && (
              <button onClick={motDePasseOublie} disabled={authEnCours}
                className="mono text-left"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: 11, textDecoration: "underline" }}>
                Mot de passe oublié ?
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Nouveau mot de passe (après clic sur le lien reçu) ----------
  if (recuperation && utilisateur) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 430 }}
          onKeyDown={(e) => { if (e.key === "Enter") validerNouveauMdp(); }}>
          <div className="disp uppercase" style={{ fontSize: 20 }}>Nouveau mot de passe</div>
          <p className="mono mt-3" style={{ fontSize: 11, color: "var(--dim)", lineHeight: 1.7 }}>
            Compte {utilisateur.email} — choisis ton nouveau mot de passe.
          </p>
          <div className="flex gap-2 mt-4">
            <input type={mdpVisible ? "text" : "password"} autoComplete="new-password"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="Nouveau mot de passe (6 min.)" value={nouveauMdp} aria-label="Nouveau mot de passe"
              onChange={(e) => setNouveauMdp(e.target.value)} className="champ flex-1" autoFocus />
            <button onClick={() => setMdpVisible((v) => !v)} type="button"
              aria-label={mdpVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="champ" style={{ cursor: "pointer", flexShrink: 0 }}>
              {mdpVisible ? "🙈" : "👁️"}
            </button>
          </div>
          <button onClick={validerNouveauMdp} disabled={recupEnCours}
            className="rounded-lg px-4 py-3 font-semibold w-full mt-4"
            style={{
              background: "var(--pelouse)", color: "#fff", fontSize: 14,
              border: "1px solid var(--pelouse2)",
              cursor: recupEnCours ? "wait" : "pointer", opacity: recupEnCours ? 0.6 : 1,
            }}>
            {recupEnCours ? "Un instant…" : "Enregistrer et continuer"}
          </button>
          {errRecup && <p className="mono mt-2" style={{ fontSize: 10, color: "var(--perdu)" }}>{errRecup}</p>}
        </div>
      </div>
    );
  }

  // ---------- Erreur de chargement ----------
  if (erreurChargement) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4">
        <style>{CSS}</style>
        <div className="panel p-6 w-full text-center" style={{ maxWidth: 430 }}>
          <div className="disp uppercase" style={{ fontSize: 20 }}>Connexion instable</div>
          <p className="mono mt-3" style={{ fontSize: 11, color: "var(--dim)", lineHeight: 1.7 }}>
            Impossible de charger ton carnet pour l'instant. Rien n'est perdu — réessaie.
          </p>
          <button onClick={() => setTentative((t) => t + 1)}
            className="rounded-lg px-4 py-3 font-semibold w-full mt-4"
            style={{ background: "var(--pelouse)", color: "#fff", fontSize: 14, border: "1px solid var(--pelouse2)", cursor: "pointer" }}>
            Réessayer
          </button>
          <button onClick={() => deconnecter()} className="mono mt-3"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: 11, textDecoration: "underline" }}>
            Me déconnecter
          </button>
        </div>
      </div>
    );
  }

  // ---------- Écran d'inscription ----------
  if (!profil) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 430 }}
          onKeyDown={(e) => { if (e.key === "Enter") inscrire(); }}>
          <div className="mono uppercase mb-2" style={{ fontSize: 9, letterSpacing: 2, color: "var(--or)" }}>
            Étape 2/4 · Pseudo
          </div>
          <div className="disp uppercase" style={{ fontSize: 24, lineHeight: 1.2 }}>
            Journal CDM 2026
          </div>
          <div className="mono mt-2" style={{ fontSize: 11, color: "var(--dim)" }}>
            11 juin → 19 juillet · 104 matchs
          </div>
          <p className="mt-4" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Choisis un pseudo pour rejoindre le classement entre amis : course au % de P&L et course à la bankroll.
          </p>
          <div className="flex gap-2 mt-4">
            <input type="text" value={pseudoInput} maxLength={16} aria-label="Pseudo"
              placeholder="Ton pseudo (ex. Clem)"
              onChange={(e) => setPseudoInput(e.target.value)}
              className="champ flex-1" autoFocus />
            <button onClick={inscrire} disabled={pseudoInput.trim().length < 2}
              className="rounded-lg px-4 py-2 font-semibold"
              style={{
                background: "var(--pelouse)", color: "#fff", fontSize: 14,
                border: "1px solid var(--pelouse2)",
                cursor: pseudoInput.trim().length < 2 ? "not-allowed" : "pointer",
                opacity: pseudoInput.trim().length < 2 ? 0.45 : 1,
              }}>
              S'inscrire
            </button>
          </div>
          {errPseudo && <p className="mono mt-2" style={{ fontSize: 10, color: "var(--perdu)" }}>{errPseudo}</p>}
          <p className="mono mt-3" style={{ fontSize: 10, color: "var(--dim)" }}>
            Connecté avec {utilisateur.email} —{" "}
            <button onClick={() => deconnecter()}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: "inherit", textDecoration: "underline" }}>
              changer de compte
            </button>
          </p>
          <p className="mono mt-4" style={{ fontSize: 10, color: "var(--dim)", lineHeight: 1.6 }}>
            Transparence totale : ton carnet (tickets, cotes, mises, résultats) est visible par tous les inscrits,
            et tamponner Gagné ou Perdu exige un screenshot que n'importe quel inscrit peut consulter.
          </p>
          {sansStockage && (
            <p className="mono mt-2" style={{ fontSize: 10, color: "var(--attente)" }}>
              Mode aperçu : sauvegarde et classement indisponibles ici.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---------- Écran des règles ----------
  if (!reglesVues) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4 py-6">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 480 }}>
          <div className="mono uppercase mb-2" style={{ fontSize: 9, letterSpacing: 2, color: "var(--or)" }}>
            Étape 3/4 · Règles
          </div>
          <div className="disp uppercase" style={{ fontSize: 22, lineHeight: 1.2 }}>
            Les règles du jeu
          </div>
          <div className="mono mt-2" style={{ fontSize: 11, color: "var(--dim)" }}>
            @{profil.pseudo} · à lire avant de tamponner
          </div>
          <ol className="mt-4 flex flex-col gap-3" style={{ fontSize: 13, lineHeight: 1.5, listStyle: "none", padding: 0, margin: 0 }}>
            {REGLES.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className="mono font-bold" style={{ color: "var(--pelouse)", fontSize: 12, minWidth: 24 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span><b>{r.titre}</b> — {r.texte}</span>
              </li>
            ))}
          </ol>
          <button onClick={() => setReglesVues(true)}
            className="rounded-lg px-4 py-3 font-semibold w-full mt-5"
            style={{ background: "var(--pelouse)", color: "#fff", fontSize: 14, border: "1px solid var(--pelouse2)", cursor: "pointer" }}>
            J'accepte les règles, c'est parti ⚽
          </button>
          <p className="mono mt-3 text-center" style={{ fontSize: 10, color: "var(--dim)" }}>
            Mise conseillée : 1–2 % de la bankroll. L'objectif : être encore là pour la finale.
          </p>
        </div>
      </div>
    );
  }

  // ---------- Écran de déclaration de bankroll ----------
  if (!departVerifie) {
    const montant = Number(String(departInput).trim().replace(",", "."));
    const montantOk = Number.isFinite(montant) && montant > 0;
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4 py-6">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 430 }}>
          <div className="mono uppercase mb-2" style={{ fontSize: 9, letterSpacing: 2, color: "var(--or)" }}>
            Étape 4/4 · Bankroll
          </div>
          <div className="disp uppercase" style={{ fontSize: 22, lineHeight: 1.2 }}>
            Déclare ta bankroll
          </div>
          <div className="mono mt-2" style={{ fontSize: 11, color: "var(--dim)" }}>
            @{profil.pseudo} · preuve obligatoire
          </div>
          <p className="mt-4" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Ta bankroll de départ sert de base au % de P&L. Joins un screenshot du solde de ton compte — il sera consultable par les inscrits.
          </p>
          <div className="flex items-center gap-2 mt-4">
            <input type="text" inputMode="decimal" value={departInput} aria-label="Bankroll de départ en euros"
              placeholder="Montant (ex. 200)" autoFocus
              onChange={(e) => setDepartInput(e.target.value)}
              className="champ mono" style={{ width: 150 }} />
            <span className="mono" style={{ fontSize: 13 }}>€</span>
          </div>
          <label className="rounded-lg px-4 py-3 font-semibold w-full mt-4 block text-center"
            style={{
              background: "var(--pelouse)", color: "#fff", fontSize: 14,
              border: "1px solid var(--pelouse2)",
              cursor: envoiBank ? "wait" : montantOk ? "pointer" : "not-allowed",
              opacity: montantOk ? 1 : 0.45,
            }}>
            {envoiBank ? "Envoi…" : "📷 Valider avec le screenshot du solde"}
            <input type="file" accept="image/*" style={{ display: "none" }}
              disabled={envoiBank || !montantOk}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) validerBankroll(f); e.target.value = ""; }} />
          </label>
          {errBank && <p className="mono mt-2" style={{ fontSize: 10, color: "var(--perdu)" }}>{errBank}</p>}
          {sansStockage && (
            <p className="mono mt-2" style={{ fontSize: 10, color: "var(--attente)" }}>
              Mode aperçu : l'envoi de preuve est indisponible ici.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---------- Étape rappels : installation + notifications (revient à chaque visite tant que pas fait) ----------
  if (!rappelsPlusTard && (!installee || rappels === "dispo")) {
    return (
      <div className="cdm min-h-screen flex items-center justify-center px-4 py-6">
        <style>{CSS}</style>
        <div className="panel p-6 w-full" style={{ maxWidth: 430 }}>
          <div className="mono uppercase mb-2" style={{ fontSize: 9, letterSpacing: 2, color: "var(--or)" }}>
            Dernière étape · Obligatoire pour les vrais
          </div>
          <div className="disp uppercase" style={{ fontSize: 22, lineHeight: 1.2 }}>
            Ne rate aucun match
          </div>
          <p className="mt-3" style={{ fontSize: 14, lineHeight: 1.6 }}>
            La compèt' dure <b>5 semaines</b>. Un carnet pas à jour = un classement faussé pour
            tout le monde. Deux rappels par jour — <b>10h</b> (tickets du jour) et <b>22h</b> (tamponner
            les résultats) — et c'est réglé.
          </p>
          {!installee ? (
            <div className="mt-4 rounded-xl p-4" style={{ background: "var(--craie)", border: "1px solid var(--ligne)" }}>
              <div className="mono uppercase font-bold" style={{ fontSize: 10, letterSpacing: 1.5 }}>
                📲 Installe l'app — 10 secondes chrono
              </div>
              <ol className="mt-2" style={{ fontSize: 13, lineHeight: 1.9, paddingLeft: 18, margin: 0 }}>
                <li>Touche le bouton <b>Partager</b> (le carré avec la flèche ⬆️, en bas de Safari)</li>
                <li>Choisis <b>« Sur l'écran d'accueil »</b></li>
                <li>Rouvre l'app depuis la nouvelle icône ⚽ — elle te proposera les rappels</li>
              </ol>
            </div>
          ) : (
            <>
              <button onClick={activerRappels}
                className="rounded-lg px-4 py-3 font-semibold w-full mt-4"
                style={{ background: "var(--pelouse)", color: "#fff", fontSize: 14, border: "1px solid var(--pelouse2)", cursor: "pointer" }}>
                🔔 Activer les rappels (10h & 22h)
              </button>
              {installPrompt && (
                <button onClick={() => { installPrompt.prompt(); setInstallPrompt(null); }}
                  className="rounded-lg px-4 py-3 font-semibold w-full mt-2"
                  style={{ background: "var(--ticket)", color: "var(--encre)", fontSize: 14, border: "1px solid var(--ligne)", cursor: "pointer" }}>
                  📲 Ajouter l'app à l'écran d'accueil
                </button>
              )}
            </>
          )}
          {rappelsMsg && <p className="mono mt-2" style={{ fontSize: 10, color: "var(--perdu)" }}>{rappelsMsg}</p>}
          <button onClick={passerRappels} className="mono mt-5"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: 10, textDecoration: "underline" }}>
            Plus tard — et tant pis si j'oublie mon carnet…
          </button>
        </div>
      </div>
    );
  }

  // ---------- App principale ----------
  return (
    <div className="cdm min-h-screen">
      <style>{CSS}</style>
      <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-4">

        {/* En-tête */}
        <div className="rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{ background: "var(--pelouse)", border: "2px solid rgba(255,255,255,.45)" }}>
          <div className="min-w-0 sm:flex-1">
            <h1 className="disp uppercase titre-app" style={{ color: "#fff" }}>
              Journal CDM 2026
            </h1>
            <div className="mono mt-1" style={{ color: "rgba(255,255,255,.75)", fontSize: 11 }}>
              @{profil.pseudo} · {paris.length} ticket{paris.length > 1 ? "s" : ""}
              {stats.enCours > 0 ? ` · ${stats.enCours} en cours` : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
          {(rappels === "dispo" || rappels === "actifs") && (
            <button onClick={rappels === "dispo" ? activerRappels : undefined}
              className="mono uppercase rounded-lg px-3 py-1.5"
              title={rappels === "actifs" ? "Rappels quotidiens activés (10h et 22h)" : "Recevoir un rappel à 10h et 22h"}
              style={{
                fontSize: 10, letterSpacing: 1, cursor: rappels === "dispo" ? "pointer" : "default",
                background: "rgba(255,255,255,.12)", color: "rgba(255,255,255,.85)",
                border: "1px solid rgba(255,255,255,.4)",
                opacity: rappels === "actifs" ? 0.7 : 1,
              }}>
              {rappels === "actifs" ? "🔔 ✓" : "🔔 Rappels"}
            </button>
          )}
          <button onClick={() => deconnecter()} className="mono uppercase rounded-lg px-3 py-1.5"
            style={{
              fontSize: 10, letterSpacing: 1, cursor: "pointer",
              background: "rgba(255,255,255,.12)", color: "rgba(255,255,255,.85)",
              border: "1px solid rgba(255,255,255,.4)",
            }}>
            Déconnexion
          </button>
          <button onClick={() => { setPartageOuvert(true); setLienPartage(null); setQrPartage(null); }}
            className="mono uppercase rounded-lg px-3 py-1.5"
            style={{
              fontSize: 10, letterSpacing: 1, cursor: "pointer",
              background: "#fff", color: "var(--pelouse)",
              border: "1px solid rgba(255,255,255,.4)", fontWeight: 700,
            }}>
            📤 Partager
          </button>
          <button onClick={() => setReglesVues(false)} className="mono uppercase rounded-lg px-3 py-1.5"
            style={{
              fontSize: 10, letterSpacing: 1, cursor: "pointer",
              background: "rgba(255,255,255,.12)", color: "rgba(255,255,255,.85)",
              border: "1px solid rgba(255,255,255,.4)",
            }}>
            Règles
          </button>
          <button onClick={toutEffacer} className="mono uppercase rounded-lg px-3 py-1.5"
            style={{
              fontSize: 10, letterSpacing: 1, cursor: "pointer",
              background: confirmReset ? "#fff" : "rgba(255,255,255,.12)",
              color: confirmReset ? "var(--perdu)" : "rgba(255,255,255,.85)",
              border: "1px solid rgba(255,255,255,.4)",
            }}>
            {confirmReset ? "Confirmer ?" : "Tout effacer"}
          </button>
          </div>
        </div>

        {/* Onglets */}
        <div className="flex gap-2">
          <button className={"tab " + (onglet === "carnet" ? "actif" : "")}
            aria-pressed={onglet === "carnet"} onClick={() => setOnglet("carnet")}>
            🎫 Mon carnet
          </button>
          <button className={"tab " + (onglet === "classement" ? "actif" : "")}
            aria-pressed={onglet === "classement"} onClick={() => setOnglet("classement")}>
            🏆 Classement
          </button>
          <button className={"tab " + (onglet === "finale" ? "actif" : "")}
            aria-pressed={onglet === "finale"} onClick={() => setOnglet("finale")}>
            🏁 Finale
          </button>
        </div>

        {sansStockage && (
          <div className="panel px-4 py-2 mono" style={{ fontSize: 11, color: "var(--attente)" }}>
            Mode aperçu : la sauvegarde et le classement ne sont pas disponibles ici.
          </div>
        )}

        {rappelsMsg && (
          <div className="panel px-4 py-2 mono flex items-center gap-2" style={{ fontSize: 11, color: "var(--encre)" }}>
            <span className="flex-1">{rappelsMsg}</span>
            <button onClick={() => setRappelsMsg(null)} aria-label="Fermer"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dim)", fontSize: 14, lineHeight: 1 }}>
              ✕
            </button>
          </div>
        )}

        {onglet === "carnet" && (
          <>
            {/* Tableau d'affichage */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="panel p-3 col-span-2">
                <div className="mono uppercase" style={{ fontSize: 10, letterSpacing: 1.5, color: "var(--dim)" }}>Bankroll</div>
                <div className="mono font-bold mt-1" style={{ fontSize: 26, color: "var(--or)" }}>{eur(stats.actuelle)}</div>
                <div className="mono mt-1 flex items-center gap-2 flex-wrap" style={{ fontSize: 10, color: "var(--dim)" }}>
                  <span>départ {eur(depart)}</span>
                  <button onClick={() => voirPreuve(profil.cle, { id: "bankroll", match: "Ma bankroll de départ", resultat: eur(depart) })}
                    title="Voir ma preuve de bankroll" className="mono"
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--pelouse)", fontSize: "inherit", textDecoration: "underline" }}>
                    📷 preuve
                  </button>
                  <button onClick={() => { setDepartInput(String(depart).replace(".", ",")); setModifBank(!modifBank); setErrBank(null); }}
                    className="mono"
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: "inherit", textDecoration: "underline" }}>
                    modifier
                  </button>
                </div>
                {modifBank && (
                  <div className="mono mt-2 flex items-center gap-2 flex-wrap" style={{ fontSize: 10 }}>
                    <input type="text" inputMode="decimal" value={departInput} aria-label="Nouvelle bankroll de départ"
                      onChange={(e) => setDepartInput(e.target.value)}
                      className="champ mono champ-mini" />
                    <label className="rounded-lg px-2 py-1 font-semibold"
                      style={{ background: "var(--pelouse)", color: "#fff", fontSize: 10, cursor: envoiBank ? "wait" : "pointer" }}>
                      {envoiBank ? "Envoi…" : "📷 Nouvelle preuve"}
                      <input type="file" accept="image/*" style={{ display: "none" }} disabled={envoiBank}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) validerBankroll(f); e.target.value = ""; }} />
                    </label>
                    {errBank && <span style={{ color: "var(--perdu)" }}>{errBank}</span>}
                  </div>
                )}
                {recharges.length > 0 && (
                  <div className="mono mt-1 flex flex-col gap-0.5" style={{ fontSize: 10, color: "var(--dim)" }}>
                    {recharges.map((r) => (
                      <span key={r.id}>
                        recharge {eurSigne(r.montant)} · {jjmm(r.date)} ·{" "}
                        <button onClick={() => voirPreuve(profil.cle, { id: r.id, match: "Recharge du " + jjmm(r.date), resultat: eurSigne(r.montant) })}
                          className="mono"
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--pelouse)", fontSize: "inherit", textDecoration: "underline" }}>
                          📷 preuve
                        </button>
                      </span>
                    ))}
                    <span>total investi {eur(stats.investi)}</span>
                  </div>
                )}
                <div className="mono mt-2" style={{ fontSize: 10 }}>
                  {rechargeOuvert ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="text" inputMode="decimal" value={rechargeMontant} aria-label="Montant remis en euros"
                        placeholder="Montant €" autoFocus
                        onChange={(e) => setRechargeMontant(e.target.value)}
                        className="champ mono champ-mini" />
                      <label className="rounded-lg px-2 py-1 font-semibold"
                        style={{ background: "var(--pelouse)", color: "#fff", fontSize: 10, cursor: envoiRecharge ? "wait" : "pointer" }}>
                        {envoiRecharge ? "Envoi…" : "📷 Preuve du dépôt"}
                        <input type="file" accept="image/*" style={{ display: "none" }} disabled={envoiRecharge}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) validerRecharge(f); e.target.value = ""; }} />
                      </label>
                      <button onClick={() => { setRechargeOuvert(false); setErrRecharge(null); }} disabled={envoiRecharge}
                        className="mono"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", fontSize: "inherit", textDecoration: "underline" }}>
                        annuler
                      </button>
                      {errRecharge && <span style={{ color: "var(--perdu)" }}>{errRecharge}</span>}
                    </div>
                  ) : (
                    <button onClick={() => { setRechargeOuvert(true); setErrRecharge(null); }}
                      className="mono"
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--or)", fontSize: "inherit", textDecoration: "underline" }}>
                      💶 Remettre des sous (screenshot exigé)
                    </button>
                  )}
                </div>
              </div>
              <Kpi label="P&L total" value={eurSigne(stats.pnlTotal)}
                sub={pourcent(stats.pctVsDepart) + (recharges.length ? " de l'investi" : " du départ")}
                color={stats.pnlTotal > 0 ? "var(--gagne)" : stats.pnlTotal < 0 ? "var(--perdu)" : undefined} />
              <Kpi label="ROI" value={stats.roi == null ? "—" : pct(stats.roi)}
                color={stats.roi > 0 ? "var(--gagne)" : stats.roi < 0 ? "var(--perdu)" : undefined} />
              <Kpi label="Réussite" value={stats.reussite == null ? "—" : pct(stats.reussite)}
                sub={stats.regles ? `${stats.g} G / ${stats.p} P` : "aucun réglé"} />
              <Kpi label="Misé (réglé)" value={eur(stats.miseTotale)}
                sub={stats.regles ? `${stats.regles} ticket${stats.regles > 1 ? "s" : ""}` : ""} />
            </div>

            {/* Courbe bankroll */}
            <div className="panel p-4">
              <Titre>Évolution de la bankroll</Titre>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={stats.courbeBankroll} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#E6E8DE" strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: "Space Mono", fill: "#6B7A70" }}
                      interval="preserveStartEnd" minTickGap={24} tickLine={false} axisLine={{ stroke: "#D9DDD0" }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: "Space Mono", fill: "#6B7A70" }}
                      tickFormatter={(v) => Math.round(v) + " €"} width={52}
                      domain={["auto", "auto"]} tickLine={false} axisLine={{ stroke: "#D9DDD0" }} />
                    <Tooltip content={<BulleBankroll />} />
                    <ReferenceLine y={depart} stroke="#9AA59B" strokeDasharray="5 4"
                      label={{ value: "départ", position: "insideTopRight", fontSize: 10, fill: "#9AA59B", fontFamily: "Space Mono" }} />
                    <Line type="monotone" dataKey="bankroll" stroke="var(--pelouse)" strokeWidth={2.5}
                      dot={{ r: 3, fill: "var(--pelouse)" }} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* P&L par jour + donut */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="panel p-4 md:col-span-2">
                <Titre>P&L par jour</Titre>
                {stats.parJour.length === 0 ? (
                  <div className="mono py-8 text-center" style={{ fontSize: 11, color: "var(--dim)" }}>
                    Apparaît dès ton premier ticket réglé.
                  </div>
                ) : (
                  <div style={{ width: "100%", height: 180 }}>
                    <ResponsiveContainer>
                      <BarChart data={stats.parJour} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="#E6E8DE" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="d" tick={{ fontSize: 10, fontFamily: "Space Mono", fill: "#6B7A70" }}
                          tickLine={false} axisLine={{ stroke: "#D9DDD0" }} />
                        <YAxis tick={{ fontSize: 10, fontFamily: "Space Mono", fill: "#6B7A70" }}
                          tickFormatter={(v) => Math.round(v) + " €"} width={48}
                          tickLine={false} axisLine={{ stroke: "#D9DDD0" }} />
                        <Tooltip content={<BulleJour />} cursor={{ fill: "#EDEFE6" }} />
                        <ReferenceLine y={0} stroke="#9AA59B" />
                        <Bar dataKey="total" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                          {stats.parJour.map((x, i) => (
                            <Cell key={i} fill={x.total >= 0 ? "var(--gagne)" : "var(--perdu)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div className="panel p-4">
                <Titre>Tickets réglés</Titre>
                {donut.length === 0 ? (
                  <div className="mono py-8 text-center" style={{ fontSize: 11, color: "var(--dim)" }}>
                    Rien à compter pour l'instant.
                  </div>
                ) : (
                  <div style={{ position: "relative", width: "100%", height: 180 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={donut} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70}
                          paddingAngle={2} isAnimationActive={false} stroke="var(--ticket)">
                          {donut.map((x, i) => <Cell key={i} fill={x.color} />)}
                        </Pie>
                        <Tooltip formatter={(v, n) => [v, n]}
                          contentStyle={{ fontFamily: "Space Mono", fontSize: 11, borderRadius: 10, border: "1px solid var(--ligne)" }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                      <div className="mono text-center">
                        <div className="font-bold" style={{ fontSize: 16 }}>
                          {stats.reussite == null ? "—" : pct(stats.reussite)}
                        </div>
                        <div style={{ fontSize: 9, color: "var(--dim)" }}>réussite</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Records */}
            <div>
              <Titre>Records</Titre>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Série en cours"
                  value={stats.serieCourante ? `${stats.serieCourante} ${stats.serieType === "Gagné" ? "G" : "P"} d'affilée` : "—"}
                  color={stats.serieType === "Gagné" ? "var(--gagne)" : stats.serieType === "Perdu" ? "var(--perdu)" : undefined}
                  sub={!stats.serieCourante ? "" : stats.serieType === "Gagné" ? "🔥 ça chauffe" : "🥶 ça pique"} />
                <Kpi label="Meilleure série"
                  value={stats.meilleureSerie ? `${stats.meilleureSerie} G d'affilée` : "—"}
                  color={stats.meilleureSerie ? "var(--gagne)" : undefined} />
                <Kpi label="Plus grosse cote gagnée"
                  value={stats.topCote ? String(stats.topCote.cote).replace(".", ",") : "—"}
                  sub={stats.topCote?.match} color={stats.topCote ? "var(--or)" : undefined} />
                <Kpi label="Meilleur jour"
                  value={stats.meilleurJour ? eurSigne(stats.meilleurJour.total) : "—"}
                  sub={stats.meilleurJour ? jjmm(stats.meilleurJour.d) : ""}
                  color={stats.meilleurJour && stats.meilleurJour.total > 0 ? "var(--gagne)" : undefined} />
              </div>
            </div>

            {/* Valider un ticket */}
            <div className="panel p-4" onKeyDown={(e) => { if (e.key === "Enter") ajouter(); }}>
              <Titre>Valider un ticket · CDM uniquement</Titre>
              <div className="flex flex-wrap gap-2 mt-1">
                <input type="date" value={form.date} aria-label="Date"
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="champ mono ch-date" />
                <input type="text" placeholder="Pari (ex. France – Brésil, ou combiné 3 matchs)" value={form.match} aria-label="Pari (match simple ou combiné)"
                  onChange={(e) => setForm({ ...form, match: e.target.value })}
                  className="champ ch-match" />
                <input type="text" inputMode="decimal" placeholder="Cote" value={form.cote} aria-label="Cote"
                  onChange={(e) => setForm({ ...form, cote: e.target.value })}
                  className="champ mono ch-cote" />
                <input type="text" inputMode="decimal" placeholder="Mise €" value={form.mise} aria-label="Mise en euros"
                  onChange={(e) => setForm({ ...form, mise: e.target.value })}
                  className="champ mono ch-mise" />
                <button onClick={ajouter} disabled={!formValide}
                  className="rounded-lg px-4 py-2 font-semibold btn-valider"
                  style={{
                    background: "var(--pelouse)", color: "#fff", fontSize: 14,
                    cursor: formValide ? "pointer" : "not-allowed",
                    opacity: formValide ? 1 : 0.45, border: "1px solid var(--pelouse2)",
                  }}>
                  Valider le ticket
                </button>
              </div>
              {num(form.cote) > 1 && num(form.mise) > 0 && (
                <div className="mono mt-2" style={{ fontSize: 11, color: "var(--dim)" }}>
                  Gain potentiel : {eurSigne(Math.round(num(form.mise) * (num(form.cote) - 1) * 100) / 100)}
                </div>
              )}
            </div>

            {/* Tickets */}
            <div className="flex flex-col gap-3 pb-2">
              <Titre>Tickets</Titre>
              {tries.length === 0 && (
                <div className="panel p-5 text-center" style={{ color: "var(--dim)", fontSize: 14 }}>
                  Aucun ticket pour l'instant. Valide ton premier pari du Mondial ci-dessus.
                </div>
              )}
              {tries.map((b) => {
                const p = pnlDe(b);
                return (
                  <div key={b.id} className="ticket">
                    <div className="px-4 py-3 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="mono rounded-md px-2 py-0.5"
                          style={{ fontSize: 10, background: "var(--craie)", color: "var(--dim)", border: "1px solid var(--ligne)" }}>
                          {jjmm(b.date)}
                        </span>
                        <span className="font-semibold truncate" style={{ fontSize: 14 }}>{b.match}</span>
                      </div>
                      <div className="mono mt-1 flex items-center gap-1 flex-wrap" style={{ fontSize: 11, color: "var(--dim)" }}>
                        {editionCote?.id === b.id ? (
                          <>
                            cote
                            <input autoFocus type="text" inputMode="decimal" value={editionCote.valeur}
                              aria-label="Nouvelle cote"
                              onChange={(e) => setEditionCote({ id: b.id, valeur: e.target.value })}
                              onBlur={changerCote}
                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                              className="champ mono champ-mini" />
                          </>
                        ) : (
                          <button onClick={() => setEditionCote({ id: b.id, valeur: String(b.cote).replace(".", ",") })}
                            title="Modifier la cote (ex. sélection annulée dans un combiné)"
                            className="mono"
                            style={{
                              background: "none", border: "none", padding: 0, cursor: "pointer",
                              color: "inherit", fontSize: "inherit",
                              textDecoration: "underline dotted", textUnderlineOffset: 2,
                            }}>
                            cote {String(b.cote).replace(".", ",")}
                          </button>
                        )}
                        <span>· mise {eur(b.mise)}</span>
                        {ctrlScreen(
                          b.id + ":tic", b.preuveTicket, "🎫 ticket", "📎 ticket avant match",
                          () => voirPreuve(profil.cle, { id: b.id + ":ticket", match: b.match, resultat: "Ticket avant match" }),
                          "ticket", b
                        )}
                        {(b.resultat === "Gagné" || b.resultat === "Perdu") && ctrlScreen(
                          b.id + ":res", b.preuve, "📷 preuve", "📷 preuve du résultat",
                          () => voirPreuve(profil.cle, b),
                          "resultat", b
                        )}
                      </div>
                      {errTicket && envoiTicket === null && (
                        <div className="mono mt-1" style={{ fontSize: 10, color: "var(--perdu)" }}>{errTicket}</div>
                      )}
                      <button onClick={() => supprimer(b.id)}
                        className="mono mt-2 uppercase"
                        style={{
                          fontSize: 9, letterSpacing: 1, cursor: "pointer", background: "none", border: "none", padding: 0,
                          color: confirmSuppr === b.id ? "var(--perdu)" : "var(--dim)",
                          textDecoration: "underline",
                        }}>
                        {confirmSuppr === b.id ? "Confirmer la suppression" : "Supprimer"}
                      </button>
                    </div>
                    <div className="stub">
                      <span className="stampwrap">
                        <select value={b.resultat} onChange={(e) => choisirResultat(b, e.target.value)}
                          disabled={envoiPreuve && preuveEnAttente?.id === b.id}
                          aria-label="Résultat du pari" className={"stamp " + stampClasse(b.resultat)}>
                          {RESULTATS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </span>
                      <span className="mono font-bold" style={{
                        fontSize: 14,
                        color: p == null ? "var(--dim)" : p > 0 ? "var(--gagne)" : p < 0 ? "var(--perdu)" : "var(--encre)",
                      }}>
                        {p == null ? "—" : eurSigne(p)}
                      </span>
                    </div>

                    {preuveEnAttente?.id === b.id && (
                      <div className="flex items-center gap-2 flex-wrap"
                        style={{ gridColumn: "1 / -1", borderTop: "2px dashed var(--ligne)", padding: "10px 14px" }}>
                        <span className="mono" style={{ fontSize: 11 }}>
                          Tamponner « {preuveEnAttente.resultat} » — screenshot obligatoire :
                        </span>
                        <label className="rounded-lg px-3 py-1.5 font-semibold"
                          style={{ background: "var(--pelouse)", color: "#fff", fontSize: 12, cursor: envoiPreuve ? "wait" : "pointer" }}>
                          {envoiPreuve ? "Envoi…" : "📷 Joindre le screenshot"}
                          <input type="file" accept="image/*" style={{ display: "none" }} disabled={envoiPreuve}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) envoyerPreuve(f); e.target.value = ""; }} />
                        </label>
                        <button onClick={() => { setPreuveEnAttente(null); setErrPreuve(null); }}
                          className="mono uppercase" disabled={envoiPreuve}
                          style={{ fontSize: 10, letterSpacing: 1, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--dim)", textDecoration: "underline" }}>
                          Annuler
                        </button>
                        {errPreuve && <span className="mono" style={{ fontSize: 10, color: "var(--perdu)" }}>{errPreuve}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {onglet === "classement" && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={chargerClassement} className="mono uppercase rounded-lg px-3 py-1.5 panel"
                style={{ fontSize: 10, letterSpacing: 1, cursor: "pointer", color: "var(--dim)" }}>
                {majClassement ? "Actualisation…" : "↻ Actualiser"}
              </button>
              <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                {joueurs.length} inscrit{joueurs.length > 1 ? "s" : ""} · clique sur un joueur pour ouvrir son carnet
              </span>
            </div>

            {/* Course au % P&L */}
            <div className="panel p-4">
              <Titre>La course au % de P&L</Titre>
              {course.length === 0 ? (
                <div className="mono py-8 text-center" style={{ fontSize: 11, color: "var(--dim)" }}>
                  La course démarre dès les premiers tickets réglés.
                </div>
              ) : (
                <>
                  <div style={{ width: "100%", height: 240 }}>
                    <ResponsiveContainer>
                      <LineChart data={course} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="#E6E8DE" strokeDasharray="3 3" />
                        <XAxis dataKey="d" tickFormatter={jjmm}
                          tick={{ fontSize: 10, fontFamily: "Space Mono", fill: "#6B7A70" }}
                          interval="preserveStartEnd" minTickGap={24} tickLine={false} axisLine={{ stroke: "#D9DDD0" }} />
                        <YAxis tick={{ fontSize: 10, fontFamily: "Space Mono", fill: "#6B7A70" }}
                          tickFormatter={(v) => v + " %"} width={52} domain={["auto", "auto"]}
                          tickLine={false} axisLine={{ stroke: "#D9DDD0" }} />
                        <Tooltip content={<BulleCourse joueurs={joueurs} />} />
                        <ReferenceLine y={0} stroke="#9AA59B" strokeDasharray="5 4" />
                        {joueurs.map((j) => (
                          <Line key={j.cle} dataKey={j.cle} type="monotone" stroke={j.color}
                            strokeWidth={j.cle === profil.cle ? 3 : 2}
                            dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    {joueurs.map((j) => (
                      <span key={j.cle} className="mono flex items-center gap-1.5" style={{ fontSize: 10, color: "var(--dim)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: j.color }} />
                        {j.pseudo}{j.cle === profil.cle ? " (toi)" : ""}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Les deux classements */}
            <div className="grid md:grid-cols-2 gap-4 pb-6">
              {[
                { titre: "Classement · % de P&L", tri: (a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0), valeur: (j) => pourcent(j.pnlPct ?? 0), couleur: (j) => (j.pnlPct > 0 ? "var(--gagne)" : j.pnlPct < 0 ? "var(--perdu)" : "var(--encre)"), sous: (j) => eurSigne(j.pnl ?? 0) },
                { titre: "Classement · Bankroll", tri: (a, b) => (b.bankroll ?? 0) - (a.bankroll ?? 0), valeur: (j) => eur(j.bankroll ?? 0), couleur: () => "var(--or)", sous: (j) => "investi " + eur(j.investi ?? j.depart ?? 0) + (j.departVerifie ? " ✓" : " (non vérifié)") + (j.recharges?.length ? ` · ${j.recharges.length} recharge${j.recharges.length > 1 ? "s" : ""}` : "") },
              ].map((c) => (
                <div key={c.titre} className="panel overflow-hidden">
                  <div className="px-4 pt-4"><Titre>{c.titre}</Titre></div>
                  {[...joueurs].sort(c.tri).map((j, i) => (
                    <button key={j.cle} className={"rang " + (j.cle === profil.cle ? "moi" : "")}
                      onClick={() => setJoueurVu(j.cle)} title={"Ouvrir le carnet de " + j.pseudo}>
                      <span className="mono font-bold" style={{ fontSize: 13, width: 28, textAlign: "center" }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "#" + (i + 1)}
                      </span>
                      <span style={{ width: 9, height: 9, borderRadius: 99, background: j.color, flexShrink: 0 }} />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold truncate" style={{ fontSize: 13, display: "block" }}>
                          {j.pseudo}{j.cle === profil.cle ? " · toi" : ""}
                        </span>
                        <span className="mono" style={{ fontSize: 9, color: "var(--dim)" }}>
                          {j.regles ?? 0} réglé{(j.regles ?? 0) > 1 ? "s" : ""} · réussite {j.reussite == null ? "—" : pct(j.reussite)}
                        </span>
                      </span>
                      <span className="forme-rang"><Forme last5={j.last5} /></span>
                      <span className="text-right" style={{ minWidth: 86 }}>
                        <span className="mono font-bold" style={{ fontSize: 14, color: c.couleur(j), display: "block" }}>
                          {c.valeur(j)}
                        </span>
                        <span className="mono" style={{ fontSize: 9, color: "var(--dim)" }}>{c.sous(j)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        {onglet === "finale" && (
          <>
            {!tournoisFini && !apercuFinale ? (
              <div className="panel p-6 text-center">
                <div className="disp uppercase" style={{ fontSize: 20 }}>🏁 La finale</div>
                <div className="mono mt-3" style={{ fontSize: 12, color: "var(--dim)" }}>
                  Podium et gage du dernier dévoilés après la finale du 19 juillet.
                </div>
                <div className="disp mt-3" style={{ fontSize: 36, color: "var(--or)" }}>J-{joursRestants}</div>
                <button onClick={() => setApercuFinale(true)} className="mono uppercase rounded-lg px-3 py-1.5 mt-4"
                  style={{ fontSize: 10, letterSpacing: 1, cursor: "pointer", background: "var(--craie)", border: "1px solid var(--ligne)", color: "var(--dim)" }}>
                  👀 Aperçu avec le classement provisoire
                </button>
              </div>
            ) : (
              <>
                {!tournoisFini && (
                  <div className="panel px-4 py-2 mono" style={{ fontSize: 10, color: "var(--attente)" }}>
                    Aperçu — classement provisoire, le vrai podium tombe le 19 juillet au soir.
                    <button onClick={() => setApercuFinale(false)} className="mono"
                      style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", color: "var(--dim)", fontSize: "inherit" }}>
                      masquer
                    </button>
                  </div>
                )}
                {podium.length < 2 ? (
                  <div className="panel p-6 text-center mono" style={{ fontSize: 12, color: "var(--dim)" }}>
                    Il faut au moins 2 inscrits pour un podium.
                  </div>
                ) : (
                  <>
                    <div className="panel p-5">
                      <Titre>🏁 Podium final · % de P&L</Titre>
                      <div className="flex items-end justify-center gap-3 mt-4">
                        {[podium[1], podium[0], podium[2]].filter(Boolean).map((j) => {
                          const rang = podium.indexOf(j);
                          const h = rang === 0 ? 110 : rang === 1 ? 80 : 58;
                          const medaille = rang === 0 ? "🥇" : rang === 1 ? "🥈" : "🥉";
                          const fond = rang === 0 ? "var(--or)" : rang === 1 ? "#9AA59B" : "#B07B4F";
                          return (
                            <div key={j.cle} className="flex flex-col items-center" style={{ width: 96, minWidth: 0 }}>
                              <span className="font-semibold truncate" style={{ fontSize: 12, maxWidth: 96 }}>
                                {j.pseudo}{j.cle === profil.cle ? " · toi" : ""}
                              </span>
                              <span className="mono font-bold" style={{ fontSize: 13, color: (j.pnlPct ?? 0) >= 0 ? "var(--gagne)" : "var(--perdu)" }}>
                                {pourcent(j.pnlPct ?? 0)}
                              </span>
                              <div className="w-full rounded-t-lg mt-1 flex items-start justify-center"
                                style={{ height: h, background: fond, border: "1px solid var(--ligne)" }}>
                                <span style={{ fontSize: 22, marginTop: 6 }}>{medaille}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="panel p-4" style={{ borderColor: "var(--perdu)" }}>
                      <Titre>🍻 Gage du dernier</Titre>
                      <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                        <b>@{podium[podium.length - 1].pseudo}</b>
                        {podium[podium.length - 1].cle === profil.cle ? " (oui, toi)" : ""}, bon dernier au % de P&L
                        ({pourcent(podium[podium.length - 1].pnlPct ?? 0)}) — la tournée est pour toi, comme le veut la règle.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        <div className="mono text-center pb-4" style={{ fontSize: 10, color: "var(--dim)" }}>
          100 % CDM 2026 · Gagné ou Perdu = screenshot vérifiable par n'importe qui · Mise conseillée : 1–2 % de la bankroll · v14
        </div>
      </div>

      {/* Carnet d'un joueur */}
      {joueurOuvert && (
        <div className="voile" onClick={() => setJoueurVu(null)}>
          <div className="panel w-full" style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--ligne)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: joueurOuvert.color }} />
              <span className="disp uppercase flex-1 truncate" style={{ fontSize: 14 }}>
                Carnet de @{joueurOuvert.pseudo}
              </span>
              <button onClick={() => setJoueurVu(null)} aria-label="Fermer"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--dim)", lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <div className="mono px-4 py-2 flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: 10, color: "var(--dim)", borderBottom: "1px solid var(--ligne)" }}>
              <span>Bankroll <b style={{ color: "var(--or)" }}>{eur(joueurOuvert.bankroll ?? 0)}</b>
                {joueurOuvert.departVerifie && (
                  <>
                    {" "}
                    <button onClick={() => voirPreuve(joueurOuvert.cle, { id: "bankroll", match: "Bankroll de @" + joueurOuvert.pseudo, resultat: "départ " + eur(joueurOuvert.depart ?? 0) })}
                      className="mono"
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--pelouse)", fontSize: "inherit", textDecoration: "underline" }}>
                      📷
                    </button>
                  </>
                )}
              </span>
              <span>P&L <b style={{ color: (joueurOuvert.pnl ?? 0) >= 0 ? "var(--gagne)" : "var(--perdu)" }}>{pourcent(joueurOuvert.pnlPct ?? 0)}</b></span>
              <span>Réussite <b>{joueurOuvert.reussite == null ? "—" : pct(joueurOuvert.reussite)}</b></span>
            </div>
            {(joueurOuvert.recharges?.length > 0) && (
              <div className="mono px-4 py-2 flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: 10, color: "var(--dim)", borderBottom: "1px solid var(--ligne)" }}>
                <span>Investi <b>{eur(joueurOuvert.investi ?? joueurOuvert.depart ?? 0)}</b></span>
                {joueurOuvert.recharges.map((r) => (
                  <span key={r.id}>
                    recharge {eurSigne(r.montant)} le {jjmm(r.date)}{" "}
                    <button onClick={() => voirPreuve(joueurOuvert.cle, { id: r.id, match: "Recharge de @" + joueurOuvert.pseudo + " le " + jjmm(r.date), resultat: eurSigne(r.montant) })}
                      className="mono"
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--pelouse)", fontSize: "inherit", textDecoration: "underline" }}>
                      📷
                    </button>
                  </span>
                ))}
              </div>
            )}
            {!(joueurOuvert.paris?.length) ? (
              <div className="px-4 py-6 text-center mono" style={{ fontSize: 11, color: "var(--dim)" }}>
                {joueurOuvert.paris ? "Aucun ticket pour l'instant." : "Carnet non partagé — il doit rouvrir son app pour publier ses tickets."}
              </div>
            ) : (
              [...joueurOuvert.paris].sort((a, b) =>
                a.date === b.date ? (b.ts || 0) - (a.ts || 0) : b.date.localeCompare(a.date)
              ).map((b) => {
                const p = pnlDe(b);
                const regle = b.resultat === "Gagné" || b.resultat === "Perdu";
                return (
                  <div key={b.id} className="px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderTop: "1px solid var(--ligne)" }}>
                    <span className="mono rounded-md px-2 py-0.5"
                      style={{ fontSize: 10, background: "var(--craie)", color: "var(--dim)", border: "1px solid var(--ligne)" }}>
                      {jjmm(b.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold truncate" style={{ fontSize: 13, display: "block" }}>{b.match}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                        cote {String(b.cote).replace(".", ",")} · mise {eur(b.mise)}
                        {b.preuveTicket && (
                          <>
                            {" · "}
                            <button onClick={() => voirPreuve(joueurOuvert.cle, { id: b.id + ":ticket", match: b.match, resultat: "Ticket placé" })} className="mono"
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--pelouse)", fontSize: "inherit", textDecoration: "underline" }}>
                              🎫 voir le ticket
                            </button>
                          </>
                        )}
                        {b.preuve ? (
                          <>
                            {" · "}
                            <button onClick={() => voirPreuve(joueurOuvert.cle, b)} className="mono"
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--pelouse)", fontSize: "inherit", textDecoration: "underline" }}>
                              📷 voir la preuve
                            </button>
                          </>
                        ) : regle ? " · sans preuve" : ""}
                      </span>
                    </span>
                    <span className={"badge " + stampClasse(b.resultat)}>{b.resultat}</span>
                    <span className="mono font-bold" style={{
                      fontSize: 13, minWidth: 70, textAlign: "right",
                      color: p == null ? "var(--dim)" : p > 0 ? "var(--gagne)" : p < 0 ? "var(--perdu)" : "var(--encre)",
                    }}>
                      {p == null ? "—" : eurSigne(p)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Partage de la carte de stats */}
      {partageOuvert && (
        <div className="voile" style={{ zIndex: 60 }} onClick={() => setPartageOuvert(false)}>
          <div className="panel p-4" style={{ maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="disp uppercase flex-1" style={{ fontSize: 16 }}>Partager mes stats</span>
              <button onClick={() => setPartageOuvert(false)} aria-label="Fermer"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--dim)", lineHeight: 1 }}>
                ✕
              </button>
            </div>

            <div className="mono uppercase mb-2" style={{ fontSize: 9, letterSpacing: 1.5, color: "var(--dim)" }}>
              Affiché sur la carte — clique pour masquer
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {[["n", "Mon pseudo"], ["p", "% de rendement"], ["m", "Montants €"], ["c", "Courbe"], ["s", "Stats détaillées"]].map(([k, label]) => (
                <button key={k} onClick={() => basculerOpt(k)}
                  className="mono rounded-full px-3 py-1.5"
                  style={{
                    fontSize: 11, cursor: "pointer", border: "1px solid var(--ligne)",
                    background: partageOpts[k] ? "var(--pelouse)" : "var(--ticket)",
                    color: partageOpts[k] ? "#fff" : "var(--dim)",
                  }}>
                  {partageOpts[k] ? "✓ " : ""}{label}
                </button>
              ))}
            </div>

            <canvas ref={apercuRef} style={{ width: "100%", borderRadius: 12, display: "block" }} />

            <div className="flex flex-col gap-2 mt-3">
              <button onClick={partagerImage}
                className="rounded-lg px-4 py-3 font-semibold"
                style={{ background: "var(--pelouse)", color: "#fff", fontSize: 14, border: "1px solid var(--pelouse2)", cursor: "pointer" }}>
                📤 Partager l'image
              </button>
              <button onClick={genererLienQR}
                className="rounded-lg px-4 py-2.5 font-semibold"
                style={{ background: "var(--ticket)", color: "var(--encre)", fontSize: 14, border: "1px solid var(--ligne)", cursor: "pointer" }}>
                🔗 Générer le lien & le QR
              </button>
            </div>

            {lienPartage && (
              <div className="mt-3 flex flex-col items-center gap-2 panel p-3">
                {qrPartage && <img src={qrPartage} alt="QR code de la carte" style={{ width: 180, height: 180 }} />}
                <div className="mono break-all text-center" style={{ fontSize: 10, color: "var(--dim)" }}>{lienPartage}</div>
                <button onClick={copierLien} className="mono rounded-lg px-3 py-1.5"
                  style={{ fontSize: 11, cursor: "pointer", border: "1px solid var(--ligne)", background: lienCopie ? "var(--pelouse)" : "var(--ticket)", color: lienCopie ? "#fff" : "var(--encre)" }}>
                  {lienCopie ? "✓ Copié !" : "📋 Copier le lien"}
                </button>
                <div className="mono text-center" style={{ fontSize: 9, color: "var(--dim)" }}>
                  Toute personne avec ce lien voit ces stats, même sans compte.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Visionneuse de preuve */}
      {preuveVue && (
        <div className="voile" style={{ zIndex: 60 }} onClick={() => setPreuveVue(null)}>
          <div className="panel p-3" style={{ maxWidth: 640, maxHeight: "88vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <span className="mono flex-1 truncate" style={{ fontSize: 11 }}>{preuveVue.titre}</span>
              <button onClick={() => setPreuveVue(null)} aria-label="Fermer"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--dim)", lineHeight: 1 }}>
                ✕
              </button>
            </div>
            {preuveVue.image ? (
              <img src={preuveVue.image} alt={"Preuve : " + preuveVue.titre}
                style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid var(--ligne)" }} />
            ) : (
              <div className="mono py-8 text-center" style={{ fontSize: 11, color: preuveVue.erreur ? "var(--perdu)" : "var(--dim)", minWidth: 240 }}>
                {preuveVue.erreur ? "Preuve introuvable." : "Chargement de la preuve…"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
