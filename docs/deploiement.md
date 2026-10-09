# Déploiement sur Railway

**Non testé en réel** : je n'ai pas accès à votre compte Railway. Les fichiers (`Dockerfile`, `railway.json`) sont prêts ; le build Docker n'a pas pu être exécuté ici non plus (pas de Docker fonctionnel dans l'environnement). Les noms des variables fournies par Railway pour Postgres et le bucket sont à vérifier dans son interface.

## 1. Projet

1. Nouveau projet Railway ; ajouter un service **PostgreSQL** et un **Bucket**.
2. Ajouter un service depuis le dépôt GitHub `adilam2026/smartcourse` (branche à déployer). Railway utilise le `Dockerfile` à la racine.
3. Dans les variables du service Docker, `ARG PG_MAJOR` : **doit être au moins égale à la version majeure du Postgres Railway** (par défaut 17). Sinon `pg_dump` refuse de sauvegarder (l'application le signale dans Réglages).

## 2. Variables du service applicatif

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | référence à l'URL du service Postgres |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | valeurs du Bucket Railway |
| `BACKUP_KEY` | phrase de passe d'au moins 16 caractères. **Notez-la hors de Railway** (gestionnaire de mots de passe) : sans elle, les sauvegardes sont illisibles |
| `INSTALL_TOKEN` | texte aléatoire d'au moins 16 caractères, à usage unique (voir §3) |
| `LOGIN_RATE_MAX` | (facultatif) plafond de connexions par minute et par adresse IP, 20 par défaut |

⚠️ Sans variables `S3_*`, les photos et les sauvegardes iraient dans le disque du conteneur, **effacé à chaque redéploiement**. Ne déployez pas en production sans le bucket.

`PORT` est fourni par Railway ; le contrôle de santé est `/health`.

## 3. Première installation

1. Après le déploiement, ouvrez l'adresse publique du service (Settings → Networking → Generate Domain).
2. Écran de connexion → « Première installation » → saisissez le `INSTALL_TOKEN`, le nom de la famille et votre profil administrateur. Le jeton est consommé de façon atomique : il ne sert qu'une fois.
3. **Supprimez ensuite la variable `INSTALL_TOKEN`.**
4. Dans Réglages, créez le profil de Lamiaa (administrateur) : avec deux administrateurs, l'un peut réinitialiser le code de l'autre.
5. Créez les profils du personnel. Chaque code à six chiffres est affiché une seule fois.
6. Sur chaque téléphone : ouvrir l'adresse, se connecter, puis « Ajouter à l'écran d'accueil » (important sur iPhone : le navigateur peut effacer les données d'un site non installé après environ 7 jours sans utilisation).

## 4. Secours : code administrateur perdu

Si aucun administrateur ne peut se connecter : depuis un terminal ayant accès à la base (`railway run`), `npm run admin -- reset <CODE_FAMILLE> <identifiant>` génère un nouveau code, révoque les sessions et journalise l'opération. `npm run admin -- token` crée un nouveau jeton d'installation.

## 5. Sauvegardes

- Automatiques : une par jour, chiffrée, dans le bucket (`backups/`), **suivie d'une restauration de contrôle dans une base temporaire** ; les anciennes sauvegardes ne sont supprimées que si la nouvelle a été restaurée correctement. Rétention : 7 jours, 4 semaines, 3 mois.
- L'état (dernière sauvegarde, dernière restauration vérifiée) s'affiche dans Réglages → Profils. Il passe en orange si la dernière vérification a plus de 3 jours ou a échoué.
- À la demande : `npm run backup -- run`, `-- verify [clé]`, `-- list`.
- **Limite** : les sauvegardes couvrent la base (profils, listes, achats, catalogue, références des photos). Les fichiers photo restent dans le bucket (durabilité assurée par Railway) mais ne sont pas copiés dans les sauvegardes. Les photos du catalogue initial se réimportent ; une photo prise par la famille perdue devrait être reprise en photo.
- Restauration réelle (sinistre) : créer une base vide, `pg_restore --no-owner --dbname=<url> fichier.dump` après déchiffrement (voir `server/src/backup.ts`, fonction `decrypt`), puis pointer `DATABASE_URL` dessus.
