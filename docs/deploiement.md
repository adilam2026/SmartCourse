# Déploiement sur Railway

## Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié ici (9 octobre 2026) :
- **Le build Docker complet réussit** (3 étapes : PWA, serveur, image finale) et le conteneur démarre, répond sur `/health`, sert la PWA (`index.html` et `sw.js` sans cache). Il s'exécute en utilisateur non privilégié (`node`).
- **Sauvegarde + restauration vérifiée avec l'image construite, contre de vrais serveurs PostgreSQL 16, 17 et 18** : résultat « restauration vérifiée, 16 tables conformes au manifeste » pour les trois.
- Le code S3 (photos et sauvegardes) tourne contre un émulateur S3 (`s3rver`) : écriture, lecture, liste, suppression, cycle complet de sauvegarde.

**Non vérifié** :
- Le build **sur l'infrastructure de Railway** et le déploiement lui-même (pas d'accès à votre compte).
- Le bucket **réel** de Railway (l'émulateur n'en est pas la copie exacte : noms des variables, point d'accès et authentification sont à vérifier dans son interface).
- Le build a été fait ici avec des images de base récupérées via un miroir (Docker Hub refusait les requêtes), et avec le certificat du proxy du bac à sable ; le `Dockerfile` de production n'a pas été modifié pour cela.

## 1. Projet

1. Nouveau projet Railway ; ajouter un service **PostgreSQL** et un **Bucket**.
2. Ajouter un service depuis le dépôt GitHub `adilam2026/smartcourse` (branche à déployer). Railway utilise le `Dockerfile` à la racine.
3. **Version de PostgreSQL** : la version du modèle Railway n'est pas stable (les sources que j'ai trouvées indiquent 16, 17 ou 18 selon la date, et Railway propose une mise à niveau majeure sur place). Un client `pg_dump` de version différente du serveur est un problème réel : trop ancien, il refuse ; trop récent, il écrit une sauvegarde que le serveur ne sait pas restaurer. **L'image contient donc les clients 16, 17 et 18 et l'application choisit celui qui correspond au serveur à chaque sauvegarde.** Si Railway passe un jour à une version 19, la sauvegarde s'arrête avec un message clair (visible dans Réglages) : il faut alors ajouter un étage `pg19` au `Dockerfile`. Contrôle à tout moment : `npm run backup -- check`.

## 2. Variables du service applicatif

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | référence à l'URL du service Postgres |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | valeurs du Bucket Railway |
| `BACKUP_KEY` | phrase de passe d'au moins 16 caractères. **Notez-la hors de Railway** (gestionnaire de mots de passe) : sans elle, les sauvegardes sont illisibles |
| `BACKUP_ALLOW_LOCAL` | **ne pas définir** (voir §5). À `1` seulement si vous montez un volume persistant sur `BACKUP_DIR` |
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

## 5. Sauvegardes : où, quand, comment

**Où** : dans le **bucket Railway**, sous le préfixe `backups/`, chiffrées (AES-256-GCM, clé dérivée de `BACKUP_KEY`). En production, **sans bucket configuré, l'application refuse de programmer des sauvegardes** (elle l'écrit dans ses journaux et Réglages affiche « NON configurée ») : le disque du conteneur est effacé à chaque redéploiement, une sauvegarde qui y serait écrite disparaîtrait en silence. Seule exception volontaire : `BACKUP_ALLOW_LOCAL=1` avec un volume persistant monté sur `BACKUP_DIR`.

**Quand** : planifié **par l'application elle-même** (pas de service cron supplémentaire, donc pas de coût de service en plus). Elle vérifie toutes les 10 minutes, et lance une sauvegarde dès que la dernière a plus de 24 heures ; la première a lieu environ 30 secondes après le premier démarrage. L'heure n'est pas fixe (elle dérive de l'heure de la dernière). Un verrou empêche deux sauvegardes simultanées. Si le service est arrêté (par exemple par un plafond de dépense atteint), aucune sauvegarde n'a lieu pendant ce temps.

**Contrôle** : chaque sauvegarde est suivie d'une restauration dans une base temporaire, comparée au manifeste (nombre de lignes de chaque table, migrations, invariants métier), puis la base temporaire est supprimée. Les anciennes sauvegardes ne sont supprimées que si la nouvelle a été restaurée correctement. Rétention : 7 jours, 4 semaines, 3 mois.

**Où le voir** : Réglages → Profils (administrateur) : stockage, planification, dernière sauvegarde, dernière restauration vérifiée, compatibilité du client `pg_dump`. Le bloc passe en orange si la dernière vérification a plus de 3 jours, a échoué, ou si le client est incompatible.

**À la demande** : `npm run backup -- check | run | verify [clé] | list | prune`.

**Limite** : les sauvegardes couvrent la base (profils, listes, achats, catalogue, références des photos). Les fichiers photo restent dans le bucket mais ne sont pas copiés dans les sauvegardes. Les photos du catalogue initial se réimportent ; une photo prise par la famille perdue serait à reprendre.

**Restauration réelle (sinistre)** : créer une base vide du **même numéro de version majeure**, déchiffrer le fichier (fonction `decrypt` de `server/src/backup.ts`), `pg_restore --no-owner --dbname=<url> fichier.dump`, puis pointer `DATABASE_URL` dessus.
