# Mise en service Railway : accès, variables, séquence

Décision : **Railway seul** (service, PostgreSQL, bucket). Déploiement autorisé sur le workspace Hobby actuel, sans toucher aux autres applications, à l'abonnement ni aux limites. **Non exécuté** tant que l'accès ci-dessous n'existe pas.

## Actions à faire par le propriétaire (liste unique)

1. **Domaines à autoriser** : menu de l'environnement cloud (barre de titre de la session) → Edit → Network access → niveau « Custom/Limited », domaines autorisés : `railway.com`, `backboard.railway.com`, `railway.app`, `*.up.railway.app` (laisser coché « Allow package managers »). Aide : https://code.claude.com/docs/en/cloud-environments#network-access
2. **Projet vide** : Railway → workspace Hobby → *New Project* → *Empty Project* → nom `SmartCourse` (région Europe). Ne rien y ajouter.
3. **Accès limité par secret d'environnement** (jamais collé dans la conversation) : dans le projet `SmartCourse` → *Settings* → *Tokens* → créer un **Project Token** (limité à ce projet et à son environnement `production`). Puis, dans la même fenêtre d'édition de l'environnement cloud que le point 1 → *Environment variables* → ajouter `RAILWAY_TOKEN` = ce jeton. La session doit être relancée pour le voir.
   - Un jeton de projet ne peut pas créer de projet ni toucher aux autres projets. S'il ne permet pas une opération (création de bucket ou de domaine selon l'API), je vous indiquerai exactement laquelle, à faire dans l'interface.
4. (Facultatif, une seule fois) Ajouter aussi `BACKUP_KEY` dans les variables d'environnement cloud si vous voulez que je la place sur le service sans la voir ; sinon la saisir vous-même dans Railway. **Dans tous les cas la noter hors de Railway.**

## Variables du service applicatif (noms seulement)

| Variable | Source |
|---|---|
| `DATABASE_URL` | référence Railway au service PostgreSQL (`${{Postgres.DATABASE_URL}}`) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | références au Bucket Railway |
| `BACKUP_KEY` | secret ≥ 16 caractères (ex. `openssl rand -base64 24`), conservé hors Railway |
| `INSTALL_TOKEN` | secret ≥ 16 caractères, à supprimer après la première installation |
| `NODE_ENV` | `production` (déjà dans l'image) |
| `PORT` | fourni par Railway |

À ne pas définir : `BACKUP_MODE` (interne par défaut), `DATABASE_SCHEMA`, `DATABASE_SSL_CA`, `BACKUP_S3_*`, `VERIFY_DATABASE_URL`, `BACKUP_ALLOW_LOCAL`.

## Séquence (réalisée par moi dès que l'accès existe)

1. Dans le projet vide : PostgreSQL + Bucket + un seul service depuis le dépôt (Dockerfile, branche actuelle), variables ci-dessus. Aucun autre service.
2. Journaux : migrations appliquées, « Images du catalogue : 80 … », `/health` OK.
3. Domaine HTTPS généré (`*.up.railway.app`) ; `node scripts/check-tunnel.mjs <adresse>` (installabilité, cookie Secure, temps réel, grosse image, hors connexion).
4. Première installation avec `INSTALL_TOKEN` (par vous : le jeton ne doit pas passer dans la conversation), puis suppression de la variable.
5. Sauvegarde : attendre la première (≈ 30 s après démarrage) ou `node dist/backup-cli.js run` ; contrôle « restauration vérifiée + photos vérifiées » ; test de restauration de photo.
6. Mesure de consommation (page Usage) pendant une semaine ; risque de dépassement signalé.
