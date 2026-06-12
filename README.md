# Journal CDM 2026 — version web (Vercel + Supabase)

Carnet de paris entre amis pour la Coupe du monde 2026 : compte par email,
tickets avec preuve par screenshot, bankroll vérifiée, classements (% de P&L
et bankroll), course multi-joueurs, podium final le 19 juillet.

## Architecture

- **Compte** : email + mot de passe (Supabase Auth). Le carnet suit le joueur
  sur n'importe quel appareil.
- **Données** : tout est sur Supabase (Postgres) — carnet perso, entrées de
  classement, preuves en image (compressées ~100–200 Ko).
- **Sécurité** : Row Level Security — chacun ne peut écrire que ses données ;
  la lecture des classements et preuves est ouverte aux inscrits
  (transparence totale, c'est la règle du jeu).

## Mise en place Supabase (une fois)

1. supabase.com → **New project** (région Europe conseillée).
2. **SQL Editor** → colle le bloc ci-dessous → **Run** :

```sql
create table public.joueurs (
  id uuid primary key references auth.users(id) on delete cascade,
  pseudo text not null,
  donnees jsonb not null default '{}'::jsonb,
  entree jsonb not null default '{}'::jsonb,
  maj timestamptz not null default now()
);

create table public.preuves (
  id text primary key,
  joueur uuid not null references public.joueurs(id) on delete cascade,
  image text not null,
  maj timestamptz not null default now()
);

alter table public.joueurs enable row level security;
alter table public.preuves enable row level security;

create policy "lecture joueurs" on public.joueurs
  for select to authenticated using (true);
create policy "creer son joueur" on public.joueurs
  for insert to authenticated with check (id = auth.uid());
create policy "modifier son joueur" on public.joueurs
  for update to authenticated using (id = auth.uid());
create policy "supprimer son joueur" on public.joueurs
  for delete to authenticated using (id = auth.uid());

create policy "lecture preuves" on public.preuves
  for select to authenticated using (true);
create policy "creer ses preuves" on public.preuves
  for insert to authenticated with check (joueur = auth.uid());
create policy "modifier ses preuves" on public.preuves
  for update to authenticated using (joueur = auth.uid());
create policy "supprimer ses preuves" on public.preuves
  for delete to authenticated using (joueur = auth.uid());
```

3. **Authentication → Sign In / Providers → Email** : désactive
   **« Confirm email »** (sinon chaque inscription exige un clic dans un
   email, et l'envoi est limité sur le SMTP par défaut).
4. **Project Settings → API** : copie **Project URL** et la clé
   **anon public**.

## Variables d'environnement Vercel

Projet Vercel → **Settings → Environment Variables** (tous les
environnements) :

- `NEXT_PUBLIC_SUPABASE_URL` = Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = clé anon public

## Déploiement

```bash
npm install
npx vercel --prod --yes
```

(Les variables doivent être en place AVANT ce build : elles sont intégrées
au moment de la compilation.)

## Développement local

Crée `.env.local` avec les deux variables, puis `npm run dev`.

## À savoir

- « Mot de passe oublié » n'a pas encore de bouton dans l'interface — en cas
  d'oubli, le mot de passe peut être réinitialisé depuis le dashboard
  Supabase (Authentication → Users).
- Toute personne ayant l'URL peut créer un compte et lire les carnets :
  garde le lien dans le groupe.
