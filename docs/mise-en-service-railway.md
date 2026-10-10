# Configuration Railway attendue par le code (sans valeur secrète)

**Constat confirmé par les logs réels** : le crash vient de `DATABASE_URL` absente (ZodError « expected string, received undefined »). Le projet Railway `trustworthy-transformation` ne contient que le service `SmartCourse` : **aucun PostgreSQL, aucun bucket**. Le code est correct ; le déploiement est incomplet.

**Règles** : ne pas créer de second service SmartCourse (celui qui existe est relié au dépôt) ; ne rien supprimer ni recréer ; ne toucher ni aux autres projets, ni à l'abonnement, ni aux limites de dépense (COMPUTE 10 $, alerte 5 $, AGENT 0 $). Hébergement 100 % Railway : pas de Supabase, B2, R2, Healthchecks ; `BACKUP_MODE` reste `internal` (valeur par défaut).

## 1. Ressources à avoir dans le projet (3 au total, aucun service en plus)

| # | Ressource | État | Action |
|---|---|---|---|
| 1 | Service `SmartCourse` (Dockerfile, `railway.json` : `/health`, redémarrage sur échec) | existe | seulement variables, région, domaine |
| 2 | **PostgreSQL** (modèle Railway) | **absent** | l'ajouter |
| 3 | **Bucket** (stockage S3 Railway, privé) | **absent** | l'ajouter |

Pas de volume, pas de cron, pas de Redis.

## 2. Prérequis à contrôler AVANT le premier démarrage

1. **Version de PostgreSQL = 16, 17 ou 18.** L'image n'embarque les clients `pg_dump`/`pg_restore` que pour ces trois versions. Si le modèle propose une autre version, s'arrêter et le signaler (sinon les sauvegardes échouent, Réglages l'affiche).
2. **Région Europe pour les trois ressources** (le service est aujourd'hui en US West). Un service, une base et un bucket dans des régions différentes ajoutent de la latence et du trafic sortant facturé. Si la région du service est modifiable, la passer en Europe ; la base et le bucket se créent directement en Europe. Rien n'est à migrer : tout est vide.
3. **`DATABASE_URL` = adresse privée** (`postgres.railway.internal`, référence `${{<NomDuServicePostgres>.DATABASE_URL}}`), pas l'adresse publique : le réseau privé est gratuit et sans TLS à configurer. Ne définir ni `DATABASE_SSL_CA`, ni `DATABASE_SCHEMA`, ni `DATABASE_POOL_MAX`.
4. **Droit `CREATE DATABASE`** : la restauration de contrôle crée une base temporaire `sc_verify_*` sur le même serveur. L'utilisateur par défaut du modèle PostgreSQL de Railway l'a. À vérifier si un autre utilisateur est utilisé.
5. **Adressage du bucket** : le code utilise par défaut l'adressage « chemin » (`endpoint/bucket/clé`). Si le bucket Railway n'accepte que l'adressage « sous-domaine » (`bucket.endpoint`), définir **`S3_FORCE_PATH_STYLE=false`** (variable ajoutée au code pour cela). Symptôme dans les journaux : « Synchronisation des images du catalogue impossible » ou erreurs `NoSuchBucket`/403/SignatureDoesNotMatch.
6. **Noms exacts des variables du bucket** : lire ceux que Railway génère (de la forme bucket, endpoint, région, clé d'accès, clé secrète) et les relier par références. Je ne connais pas leurs noms avec certitude : ne pas les deviner.
7. **`BACKUP_KEY` et `INSTALL_TOKEN`** : chacun ≥ 16 caractères, générés par le propriétaire (par ex. `openssl rand -base64 24`), jamais copiés dans une conversation. **`BACKUP_KEY` est à noter hors de Railway** : sans elle les sauvegardes sont illisibles.

## 3. Variables du service `SmartCourse` (noms uniquement)

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | référence au PostgreSQL (adresse privée) |
| `S3_BUCKET` | nom du bucket (référence) |
| `S3_ENDPOINT` | point d'accès S3 du bucket (référence) |
| `S3_REGION` | région du bucket (référence ; `auto` si le fournisseur n'en donne pas) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | clés du bucket (références) |
| `S3_FORCE_PATH_STYLE` | `false` **seulement** si le point 5 l'exige ; sinon ne pas définir |
| `BACKUP_KEY` | secret du propriétaire |
| `INSTALL_TOKEN` | secret du propriétaire, **temporaire** (à supprimer après la première installation) |
| `PORT`, `NODE_ENV` | `PORT` fourni par Railway ; `NODE_ENV=production` est dans l'image |

**À ne pas définir** : `BACKUP_MODE`, `BACKUP_ALLOW_LOCAL`, `BACKUP_S3_*`, `VERIFY_DATABASE_URL`, `DATABASE_SSL_CA`, `DATABASE_SCHEMA`, `PHOTO_DIR`.

Sans les variables `S3_*`, en production, l'application démarre mais les images iraient sur le disque du conteneur (effacé à chaque déploiement) et les sauvegardes sont refusées : ne pas déployer sans bucket.

## 4. Séquence

1. Ajouter PostgreSQL (Europe) puis le Bucket (Europe, privé).
2. Définir les variables du §3 sur le service existant ; région du service en Europe si possible.
3. Redéployer le service existant (pas de nouveau service).
4. Lire les journaux de démarrage. Lignes attendues, dans l'ordre :
   - migrations appliquées, sans erreur (aucune ligne « Tables protégées… » : normal, il n'y a pas de rôles Supabase) ;
   - `Images du catalogue : 80 remplacée(s) ou ajoutée(s), 0 déjà à jour.` au premier démarrage, puis `0 remplacée(s)… 80 déjà à jour` aux suivants ;
   - `Sauvegardes automatiques actives (stockage : s3).` (sinon : `BACKUP_KEY présent mais aucun stockage sûr` = bucket mal relié) ;
   - environ 30 s après : `backup backups/… restauration vérifiée` ; en cas d'échec le message liste les problèmes.
5. Générer le domaine HTTPS `*.up.railway.app` (Settings → Networking). `GET /health` doit répondre 200.
6. Première installation par le propriétaire (voir `deploiement.md` §3) avec `INSTALL_TOKEN`, puis **supprimer `INSTALL_TOKEN`**.
7. Contrôles : connexion, synchronisation entre deux appareils, ajout d'une photo (vérifie l'écriture dans le bucket), sauvegarde suivante : « photos vérifiées » ; `node dist/backup-cli.js check` dans le conteneur pour la compatibilité `pg_dump`.
8. Mesure de consommation (page Usage) pendant une semaine. Les 5 $ restent un objectif, pas une garantie : l'application seule est estimée à 1,2–2,6 $ par mois, la consommation de vos autres applications s'y ajoute et est inconnue.

## 5. Risques à signaler

- **Bucket unique** : photos, leurs copies de sauvegarde et sauvegardes de la base sont dans le même bucket ; sa perte totale emporterait tout. Exporter de temps en temps un fichier de sauvegarde.
- **Plafond COMPUTE à 10 $ par workspace** : l'atteindre arrête tous les services du workspace, pas seulement SmartCourse.
- Premier démarrage : le contrôle de santé laisse 300 s ; le démarrage (migrations, 80 images, import) prend quelques secondes à une minute.
