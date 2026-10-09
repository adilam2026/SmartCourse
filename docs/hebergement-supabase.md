# Hébergement choisi : Railway (serveur) + Supabase Free (base PostgreSQL)

**Statut : adaptations du code faites et testées localement ; rien n'est créé, rien n'est déployé, aucun abonnement, aucune limite Railway modifiée.** Le choix d'architecture est confirmé ; il n'autorise pas encore la création de services ni le déploiement.

## 1. Portes à franchir avant toute création de service

| # | Condition | État |
|---|---|---|
| G1 | **Un projet Supabase Free est disponible** (moins de 2 projets Free actifs, toutes organisations dont vous êtes propriétaire ou administratrice confondues) | **Non vérifiable par moi** (aucun accès à votre compte). À vérifier par vous : liste de vos organisations et projets, statut de chacun |
| G2 | **Consommation de votre workspace Railway** (U) | **Non fournie** : le coût total ci-dessous reste conditionnel |
| G3 | **Stockage de sauvegarde indépendant choisi et ouvert** (Cloudflare R2 ou Backblaze B2) | À décider et à ouvrir par vous (compte à créer) |
| G4 | **Un run manuel du job de sauvegarde externe réussi** (§5), avant de passer l'application en mode `BACKUP_MODE=external` | Non réalisé : le job n'a jamais tourné (aucun secret, aucune base Supabase) |
| G5 | Votre accord écrit sur la mise en service | En attente |

## 2. Où seront les données

| Donnée | Emplacement | Pourquoi |
|---|---|---|
| Base PostgreSQL (profils, listes, achats, catalogue, références d'images) | **Supabase Free** (région proche de Railway : Europe) | Évite un service PostgreSQL payant sur Railway |
| Serveur (API + application installable) | **Railway**, 1 service | Domaine HTTPS stable fourni par Railway |
| Images (80 visuels du catalogue + images ajoutées par la famille) | **Bucket Railway** (S3) : variables `S3_*` | Moins de 0,05 Go (< 0,01 $ par mois d'après les tarifs relevés) ; Supabase Storage n'apporterait aucun gain |
| **Sauvegardes de la base** (chiffrées AES-256-GCM, clé `BACKUP_KEY`) | **Stockage S3 indépendant** : Cloudflare R2 ou Backblaze B2 (10 Go gratuits chacun) | Une panne ou une suppression chez Supabase **ou** Railway n'emporte pas les sauvegardes |
| **Copie des photos de la famille** | Même stockage indépendant, sous `photos/` | Les sauvegardes de la base ne contiennent que les références |
| Clé `BACKUP_KEY` | **Hors Railway et hors GitHub** (gestionnaire de mots de passe) *et* en secret GitHub pour le job | Sans elle, les sauvegardes sont illisibles |

## 3. Coût total estimé (conditionnel à U)

Estimations d'après des mesures locales ; les tarifs Railway viennent de sources secondaires concordantes, **à reconfirmer sur votre page Usage**. Ce ne sont pas des seuils garantis.

| Poste (par mois) | Estimation |
|---|---|
| Service Railway (≈ 0,11 Go de mémoire, CPU quasi nul) | ≈ 1,2 à 1,6 $ (jusqu'à ≈ 2,5 $ en fourchette prudente) |
| Bucket Railway (images) | < 0,01 $ |
| Supabase Free (base) | 0 $ |
| Stockage de sauvegardes (R2 ou B2, dans les 10 Go gratuits) | 0 $ |
| Tâche planifiée GitHub Actions (≈ 5 min par jour) | 0 $ attendu (minutes incluses ; **à confirmer** pour votre type de dépôt) |
| **Application** | **≈ 1,2 à 1,7 $ (prudent : jusqu'à ≈ 2,6 $)** |
| **Total Railway = U + application** | voir ci-dessous |

Votre abonnement Hobby de 5 $ inclut 5 $ de consommation : vous ne payez de plus que le dépassement. **Je ne connais pas U** (consommation mensuelle de vos autres applications), donc je ne peux pas dire si le total reste sous 5 $ :

| Si U vaut… | Total estimé (application seule 1,2–1,7 $) | Total « prudent » (jusqu'à 2,6 $) |
|---|---|---|
| 1 $ | ≈ 2,2 à 2,7 $ | ≈ 3,6 $ |
| 2 $ | ≈ 3,2 à 3,7 $ | ≈ 4,6 $ |
| 3 $ | ≈ 4,2 à 4,7 $ | ≈ 5,6 $ : **dépassement possible** |
| 4 $ ou plus | ≈ 5,2 $ ou plus | dépassement probable |

**Scénarios estimatifs, pas des limites Railway.** Aucun ne garantit le zéro dépassement : seule une semaine de mesure après mise en service le dira. Vos limites (alerte 5 $, plafond 10 $, AGENT 0 $) ne sont pas modifiées.

## 4. Limites et risques du plan gratuit Supabase

| Limite / risque | Conséquence |
|---|---|
| **Base : 500 Mo** (la nôtre : < 10 Mo au départ) | Au-delà : **lecture seule**, la famille ne peut plus rien écrire |
| **Pause après 7 jours de faible activité** | Application hors service jusqu'à reprise manuelle (« Resume project ») ; avertissement par e-mail environ 1 semaine avant ; restauration possible 1 an selon le texte de la documentation (sa page est incohérente). **Aucune garantie** qu'une sauvegarde quotidienne compte comme activité suffisante |
| **Sortie : 5 Go non cachée, 5 Go cachée par mois**, par organisation, partagés par tous vos projets | Notre trafic base → serveur est de la sortie non cachée. Estimé ≈ 0,03 Go/mois en usage normal, ≈ 0,3 à 1 Go si le temps réel est retenu et que les téléphones restent ouverts des heures (à vérifier). Au dépassement : restrictions de l'organisation jusqu'au cycle suivant |
| **Pas de sauvegarde automatique** (Free) | Remplacée par notre job (§5) ; sans lui, aucune copie |
| **Connexion** : la connexion directe est IPv6 seulement ; le pooler en mode transaction (6543) casse les verrous de session | On utilise le **pooler en mode session (port 5432)** ; le code refuse le port 6543 |
| **Limite de connexions du plan** | Non confirmée (page non lue) ; notre pool est de 10 connexions maximum |
| **Disponibilité** | Pas d'engagement de service en Free |
| **API de données de Supabase** | Elle expose le schéma `public` aux rôles `anon`/`authenticated` : **protégée par notre code** (§6) ; il reste prudent de ne jamais utiliser ni publier les clés `anon`/`service_role` |
| Dépendance au certificat | Sans `DATABASE_SSL_CA`, le serveur **refuse de démarrer** sur une base Supabase |

## 5. Sauvegardes indépendantes avec restauration vérifiée

Fichier : `.github/workflows/backup-externe.yml`. Chaque jour (et à la demande) :
1. lit la version majeure de PostgreSQL de Supabase ;
2. installe le client `pg_dump` de **la même version** ;
3. démarre un **PostgreSQL jetable de la même version** (conteneur du coureur GitHub) ;
4. fait la sauvegarde cohérente (instantané unique, manifeste des comptages), la **chiffre**, la dépose dans le stockage indépendant ;
5. la **restaure dans le serveur jetable** et la compare au manifeste (comptage de chaque table, migrations, invariants métier) ; **la sauvegarde n'est déclarée valide qu'après cette restauration** ;
6. n'applique la rétention (7 quotidiennes, 4 hebdomadaires, 3 mensuelles) qu'après une restauration réussie ;
7. copie les photos de la famille ;
8. écrit le résultat dans la table `backup_runs` de la base : **Réglages → Profils** affiche la dernière sauvegarde et la dernière restauration vérifiée ; l'application consigne une erreur si aucune restauration vérifiée n'a eu lieu depuis 36 h, et l'écran passe en orange après 3 jours.

Ce job **ne migre jamais** et ne modifie jamais les droits de la base de production.

**Secrets GitHub à créer par vous** (Settings → Secrets and variables → Actions) : `DATABASE_URL` (pooler **session**, port 5432), `DATABASE_SSL_CA` (certificat racine en texte), `BACKUP_KEY`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` ; pour copier les photos : `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (accès au bucket d'images). Sans les 7 premiers, le job s'arrête avec un message clair, sans rien faire.

**Contraintes à connaître**
- GitHub n'exécute le déclencheur planifié que pour un fichier présent sur la **branche par défaut** : tant que cette branche n'est pas fusionnée, seul le lancement manuel marche.
- Les secrets de connexion à la base sont stockés dans GitHub.
- Un échec du job envoie un e-mail GitHub ; il n'y a pas d'autre alerte tant qu'aucune n'est ajoutée.

**Ne pas désactiver les sauvegardes sans remplacement opérationnel** : le mode par défaut reste `BACKUP_MODE=internal` (sauvegardes de l'application, inchangées). Le passage à `external` n'est à faire qu'**après le premier run manuel réussi** (porte G4). Important : sur Supabase, le mode `internal` ne peut pas vérifier ses restaurations (il crée une base jetable sur le même serveur) : il ne faut donc **pas** mettre l'application en production sur Supabase en mode `internal`.

**Restauration en cas de sinistre** (à répéter une fois par mois pour la tester) : télécharger la dernière sauvegarde `.dump.enc` du stockage indépendant ; la déchiffrer avec `BACKUP_KEY` (fonction `decrypt` de `server/src/backup.ts`) ; `pg_restore --no-owner --dbname=<nouvelle base de la même version>` ; recopier `photos/` vers le bucket d'images ; pointer `DATABASE_URL` sur la nouvelle base.

## 6. Ce que j'ai adapté dans le code (tout est testé localement)

| Adaptation | Fichiers | Vérification |
|---|---|---|
| **Connexion sécurisée** : `DATABASE_SSL_CA` (texte PEM ou fichier) → connexion chiffrée **et** certificat vérifié ; refus du pooler en mode transaction (6543) ; refus d'une base Supabase sans certificat ; URL fournie aux outils libpq en `verify-full` | `db.ts`, `config.ts` | Tests avec un **vrai TLS** (serveur local) : accepté avec le bon certificat, refusé sans lui ou avec un autre ; `pg_dump` accepté/refusé de même |
| **Protection des tables** : si les rôles `anon`/`authenticated` existent, sécurité par ligne (RLS) activée partout, tous les droits retirés (tables, séquences, fonctions, schéma), droits par défaut retirés, contrôle final qui **fait échouer le démarrage** si une table reste exposée ; rien n'est fait sur un PostgreSQL ordinaire | `harden.ts`, `index.ts`, outils en ligne de commande | Test qui reproduit les droits par défaut de Supabase, vérifie fermeture, idempotence, table créée après, et que le serveur (propriétaire) continue à tout lire |
| **Migrations** : verrou de session conservé (mode session) | `migrate.ts` (inchangé) | Garde-fou du port 6543 |
| **Sauvegarde externe** : serveur de contrôle distinct (`VERIFY_DATABASE_URL`, même version majeure exigée), stockage dédié (`BACKUP_S3_*`), copie des photos, mode `external`, état affiché, aucune migration par le job | `backup.ts`, `backup-cli.ts`, `backup-store.ts`, `backup-photos.ts`, `app.ts`, `index.ts`, workflow | Tests (restauration vers une autre base, mauvais accès refusé, photos copiées une fois, absentes signalées, état) ; parcours complet `run` + `photos` en local avec la même commande que le workflow |
| Client S3 : somme de contrôle seulement quand elle est exigée | `photos.ts` | Tests S3 existants (143 tests serveur) |

## 7. Ce qui n'est PAS vérifié
- tout ce qui touche un **vrai projet Supabase** : connexion par le pooler en mode session, certificat racine (nom d'hôte du pooler), droits du rôle `postgres` pour activer la RLS et modifier les droits par défaut, version de PostgreSQL, limite de connexions ;
- le **workflow de sauvegarde** : jamais exécuté (étapes PGDG, conteneur jetable, secrets) ;
- la compatibilité du stockage **R2 ou B2** avec notre client (précautions prises, non testées) ;
- l'accès externe au **bucket Railway** (pour la copie des photos) ;
- l'interface **Réglages** en mode externe sur un vrai téléphone.

## 8. Mise en service : liste d'étapes (rien n'est exécuté)
1. **Vous** : relever U (usage Railway), vérifier vos projets Supabase (G1), choisir R2 ou B2 (G3).
2. **Vous** : créer le projet Supabase (région Europe, mot de passe fort) ; en relever : l'URL du **pooler en mode session**, le certificat racine ; vous ne me donnez aucun mot de passe.
3. **Vous** : créer le stockage de sauvegarde et son accès ; créer les secrets GitHub ; choisir et conserver `BACKUP_KEY`.
4. Lancer **à la main** le workflow `backup-externe` ; constater : sauvegarde déposée, restauration vérifiée (G4). Sans cela, ne pas continuer.
5. Création du service Railway + bucket (après votre accord écrit) avec : `DATABASE_URL`, `DATABASE_SSL_CA`, `S3_*`, `BACKUP_KEY`, `BACKUP_MODE=external`, `INSTALL_TOKEN`.
6. Premier démarrage : journaux « Tables protégées contre l'API de données », « Images du catalogue : 80 », `/health` ; puis `scripts/check-tunnel.mjs` sur l'adresse Railway.
7. Première installation, suppression de `INSTALL_TOKEN`, création des profils, **recette sur le vrai Android** avec l'adresse stable.
8. **Une semaine de mesure** : usage Railway, sortie et taille de base Supabase, résultat quotidien des sauvegardes ; mise à jour de `couts.md`.
