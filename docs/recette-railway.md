# Service Railway de recette (iPhone ↔ Android)

Recette accessible en HTTPS aux deux appareils, **dans un projet Railway séparé de la production** : base, réseau privé et
variables propres ; aucune référence possible à la base de production. Données entièrement fictives.

## Ce que contient le dépôt (rien à écrire de votre côté)

| Fichier | Rôle |
|---|---|
| `railway.recette.json` | configuration du service de recette (construit avec `Dockerfile.recette`) ; la production garde `railway.json` et `Dockerfile` |
| `Dockerfile.recette` | même application, même Node fixé ; ajoute un faux service d'e-mails local et la création de la famille fictive |
| `scripts/recette-railway.sh` | démarrage : **refuse de démarrer si le nom du projet Railway ne contient pas « recette »** ; e-mails envoyés au faux service local (aucun e-mail réel) ; aucun stockage S3 ni sauvegarde ; famille fictive « Recette » (identifiant `RecetteCourses`, membres adil / lamiaa / marie) créée au premier démarrage |
| `.github/workflows/ios-recette-railway.yml` | contrôles iPhone ↔ Android sur cette recette |

## Actions Railway nécessaires (une seule fois)

1. **New Project** → *Deploy from GitHub repo* → `adilam2026/SmartCourse`, branche **`claude/ios-kmp`**.
   Nommer le projet avec le mot **recette** (par exemple `smartcourse-recette`), sinon le service refuse de démarrer.
2. Dans ce même projet : **+ New → Database → PostgreSQL**.
3. Service de l'application → **Settings** :
   - *Config-as-code* → chemin du fichier : `railway.recette.json` ;
   - *Networking* → **Generate Domain** (adresse HTTPS `….up.railway.app`).
4. Service de l'application → **Variables** (2 seulement) :
   - `DATABASE_URL` = référence `${{Postgres.DATABASE_URL}}` (la base de CE projet) ;
   - `INSTALL_TOKEN` = une valeur aléatoire d'au moins 16 caractères (elle ne sert qu'à créer la famille fictive ;
     ne pas la communiquer).
5. M'indiquer l'adresse générée (elle n'est pas secrète) : je la renseigne dans le contrôle et je le lance.

Rien d'autre : pas de bucket, pas de clé d'e-mail, pas de clé de sauvegarde, aucune modification du projet de production.

## Coût estimé

D'après les mesures de `couts.md` (Node ≈ 110 Mo, Postgres ≈ 90–150 Mo, CPU quasi nul au repos), service allumé en continu :
**environ 2 à 3 $ par mois** (mémoire ≈ 2–2,6 $, CPU ≈ 0,2 $, disque et réseau < 0,1 $). Un contrôle complet (≈ 1 h) coûte
quelques centimes.

**Point d'attention** : cette consommation s'ajoute à celle de la production dans le **même workspace**, donc dans le même
plafond COMPUTE de 10 $ (à 10 $, tous les services du workspace s'arrêtent, production comprise). Pour la limiter :

- supprimer le projet de recette après la validation (aucune donnée réelle à conserver), ou
- activer *Serverless* (mise en veille) sur le service de l'application : il ne consomme presque plus rien entre deux
  contrôles ; seule la base reste allumée (≈ 1 à 1,5 $ par mois).

## Séparation d'avec la production

- Projet distinct : la base de recette ne peut pas être celle de la production, et inversement.
- Garde-fou au démarrage (nom du projet), e-mails toujours dirigés vers le faux service local, variables S3 ignorées.
- Données fictives seulement (famille « Recette », adresse `recette@example.org`).
- Les applications de recette (APK `.nativeproto`, iPhone `….recette`) sont distinctes des applications publiées.
