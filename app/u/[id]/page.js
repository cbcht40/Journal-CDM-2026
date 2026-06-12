"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { lireProfilPublic } from "../../../lib/supabase";
import { dessinerCarte } from "../../../lib/carte";

export default function CartePublique() {
  const params = useParams();
  const recherche = useSearchParams();
  const canvasRef = useRef(null);
  const [etat, setEtat] = useState("chargement"); // chargement | ok | introuvable | erreur
  const [pseudo, setPseudo] = useState("");

  const opts = {
    n: recherche.get("n") !== "0",
    m: recherche.get("m") !== "0",
    p: recherche.get("p") !== "0",
    c: recherche.get("c") !== "0",
    s: recherche.get("s") !== "0",
  };

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const ligne = await lireProfilPublic(params.id);
        if (!actif) return;
        if (!ligne) { setEtat("introuvable"); return; }
        const e = ligne.entree || {};
        const data = {
          pseudo: ligne.pseudo,
          bankroll: e.bankroll, depart: e.depart, investi: e.investi,
          pnl: e.pnl, pnlPct: e.pnlPct, roi: e.roi, reussite: e.reussite,
          regles: e.regles, enCours: e.enCours, last5: e.last5, courbe: e.courbe,
        };
        setPseudo(ligne.pseudo || "");
        setEtat("ok");
        // Laisse le canvas se monter avant de dessiner
        requestAnimationFrame(() => { if (canvasRef.current) dessinerCarte(canvasRef.current, data, opts); });
      } catch (err) {
        if (actif) setEtat("erreur");
      }
    })();
    return () => { actif = false; };
  }, [params.id]);

  const telecharger = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "stats-cdm-" + (pseudo || "joueur") + ".png";
      a.click();
    }, "image/png");
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F1F2EC", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 16, fontFamily: "system-ui, sans-serif", gap: 16,
    }}>
      {etat === "chargement" && <div style={{ color: "#6B7A70" }}>Chargement de la carte…</div>}
      {etat === "introuvable" && <div style={{ color: "#6B7A70", textAlign: "center" }}>Carte introuvable — le joueur n'a peut-être pas encore publié ses stats.</div>}
      {etat === "erreur" && <div style={{ color: "#B42318", textAlign: "center" }}>Impossible de charger la carte pour l'instant.</div>}
      <canvas ref={canvasRef} style={{ display: etat === "ok" ? "block" : "none", borderRadius: 16, boxShadow: "0 10px 40px rgba(0,0,0,.15)", maxWidth: "100%" }} />
      {etat === "ok" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={telecharger}
            style={{ background: "#0E5A3C", color: "#fff", border: "1px solid #0A4530", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            📥 Télécharger l'image
          </button>
          <a href="/"
            style={{ background: "#fff", color: "#15241C", border: "1px solid #D9DDD0", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            ⚽ Rejoindre le Journal CDM 2026
          </a>
        </div>
      )}
    </div>
  );
}
