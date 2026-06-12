import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && anon ? createClient(url, anon) : null;

async function monId() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}

// ---------- Auth ----------
export async function inscrireEmail(email, password) {
  // 1) Si un compte existe déjà avec ces identifiants, on s'y connecte au lieu
  //    d'en créer un doublon (cas « je clique Créer alors que je suis déjà inscrit »).
  const essai = await supabase.auth.signInWithPassword({ email, password });
  if (!essai.error) return essai.data;
  // Compte existant mais email jamais confirmé : surtout ne pas re-signUp,
  // Supabase créerait un deuxième utilisateur avec le même email.
  if ((essai.error.message || "").includes("Email not confirmed")) throw essai.error;

  // 2) Sinon, création réelle du compte.
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  // Email déjà enregistré avec un autre mot de passe : Supabase renvoie un
  // utilisateur factice sans identité (protection anti-énumération).
  if (data?.user && !data?.session && (data.user.identities?.length ?? 0) === 0) {
    throw new Error("User already registered");
  }
  return data;
}

export async function connecterEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function deconnecter() {
  await supabase.auth.signOut();
}

export async function demanderReinitMdp(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  if (error) throw error;
}

export async function changerMotDePasse(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

// ---------- Joueur connecté ----------
export async function chargerMoi() {
  const id = await monId();
  if (!id) return null;
  const { data, error } = await supabase
    .from("joueurs").select("pseudo, donnees").eq("id", id).maybeSingle();
  if (error) throw error;
  return data; // null si pas encore de pseudo
}

export async function sauverMoi(pseudo, donnees, entree) {
  const id = await monId();
  if (!id) throw new Error("non connecté");
  const { error } = await supabase.from("joueurs").upsert({
    id, pseudo, donnees, entree, maj: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function viderMesDonnees() {
  const id = await monId();
  if (!id) return;
  await supabase.from("preuves").delete().eq("joueur", id);
  await supabase.from("joueurs").delete().eq("id", id);
}

// ---------- Classement ----------
export async function listerJoueurs() {
  const { data, error } = await supabase.from("joueurs").select("id, pseudo, entree");
  if (error) throw error;
  return data || [];
}

// ---------- Preuves ----------
export async function sauverPreuve(ref, image) {
  const id = await monId();
  if (!id) throw new Error("non connecté");
  const { error } = await supabase.from("preuves").upsert({
    id: id + ":" + ref, joueur: id, image, maj: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function lirePreuve(idJoueur, ref) {
  const { data, error } = await supabase
    .from("preuves").select("image").eq("id", idJoueur + ":" + ref).maybeSingle();
  if (error) throw error;
  return data?.image || null;
}

export async function supprimerPreuve(ref) {
  const id = await monId();
  if (!id) return;
  await supabase.from("preuves").delete().eq("id", id + ":" + ref);
}
