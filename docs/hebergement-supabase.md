# Hébergement choisi : Railway (serveur) + Supabase Free (base PostgreSQL)

**Statut : adaptations du code faites et testées EN LOCAL ; rien n'est créé, rien n'est déployé, aucun abonnement, aucune limite Railway modifiée.** Les essais locaux ne valident ni Supabase, ni le bucket Railway, ni le stockage de sauvegarde : voir §8 pour ce qui reste à valider sur les vrais services.

## 1. Portes à franchir avant toute création de service

| # | Condition | État |
|---|---|---|
| G1 | **Un projet Supabase Free est disponible** (moins de 2 projets Free actifs, toutes organisations dont vous êtes propriétaire ou administratrice confondues) | **Non vérifiable par moi** (aucun accès à votre compte) : captures attendues |
| G2 | **Consommation de votre workspace Railway** (U) | Captures attendues : le coût total reste conditionnel |
| G3 | **Stockage de sauvegarde indépendant** : Backblaze B2 recommandé (§7), compte à créer **après votre accord** | Non créé |
| G4 | **Validation sur les vrais services** (§8) : un lancement manuel du job de sauvegarde externe réussi, avec restauration complète vérifiée | **Non réalisée** : aucun service réel n'existe encore |
| G5 | Variable de dépôt `BACKUP_EXTERNE_ACTIVE=true` créée **après** G4 (sinon la planification reste inactive) | À faire après G4 |
| G6 | Votre accord écrit sur la mise en service | En attente |

## 2. Où seront les données

| Donnée | Emplacement | Pourquoi |
|---|---|---|
| Base PostgreSQL | **Supabase Free**, projet en Europe, **schéma `smartcourse` (jamais `public`)** | Pas de service PostgreSQL payant ; isolation des autres applications |
| Serveur (API + application installable) | **Railway**, 1 service, domaine HTTPS stable fourni par Railway | |
| Images (80 visuels + images ajoutées par la famille) | **Bucket Railway** (`S3_*`) | < 0,05 Go, < 0,01 $ par mois d'après les tarifs relevés |
| Sauvegardes de la base (chiffrées AES-256-GCM) et copie des photos de la famille | **Backblaze B2** (recommandé, §7) : un bucket privé, une clé d'accès limitée à ce bucket | Indépendant de Railway et de Supabase |
| `BACKUP_KEY` | Votre gestionnaire de mots de passe **et** secret GitHub du job. **Pas** dans Railway : le serveur n'en a pas besoin en mode externe | Sans elle, les sauvegardes sont illisibles |

## 3. Coût total estimé (conditionnel à U)

Estimations d'après des mesures locales ; tarifs Railway issus de sources secondaires concordantes, **à reconfirmer sur votre page Usage**. Ce ne sont pas des seuils garantis.

| Poste (par mois) | Estimation |
|---|---|
| Service Railway (≈ 0,11 Go de mémoire, CPU quasi nul) | ≈ 1,2 à 1,6 $ (jusqu'à ≈ 2,5 $ en fourchette prudente) |
| Bucket Railway (images) | < 0,01 $ |
| Supabase Free | 0 $ |
| Backblaze B2 (< 10 Go gratuits ; nos sauvegardes pèseront quelques dizaines de Mo) | 0 $ |
| **GitHub Actions** | **0 $ : votre dépôt est PUBLIC** (vérifié par l'API GitHub) ; selon la documentation GitHub, les exécuteurs standard sont gratuits pour les dépôts publics. Pour mémoire : un dépôt privé disposerait de 2 000 minutes par mois avec GitHub Free (3 000 avec Pro ou Team), largement suffisant pour ≈ 5 min par jour |
| **Application** | **≈ 1,2 à 1,7 $ (prudent : jusqu'à ≈ 2,6 $)** |

Total Railway = U + application, et vous ne payez que le dépassement des 5 $ inclus. **Je ne connais pas U.** Scénarios (estimatifs, pas des limites) :

| Si U vaut… | Total estimé | Total « prudent » |
|---|---|---|
| 1 $ | ≈ 2,2 à 2,7 $ | ≈ 3,6 $ |
| 2 $ | ≈ 3,2 à 3,7 $ | ≈ 4,6 $ |
| 3 $ | ≈ 4,2 à 4,7 $ | ≈ 5,6 $ : dépassement possible |
| 4 $ ou plus | ≈ 5,2 $ ou plus | dépassement probable |

Aucun ne garantit le zéro dépassement : seule une semaine de mesure après mise en service le dira. Vos limites (alerte 5 $, plafond 10 $, AGENT 0 $) ne sont pas modifiées.

## 4. Limites et risques du plan gratuit Supabase

| Limite / risque | Conséquence |
|---|---|
| **Base : 500 Mo** (la nôtre : < 10 Mo au départ) | Au-delà : **lecture seule** |
| **Pause après 7 jours de faible activité** | Application hors service jusqu'à reprise manuelle ; e-mail d'avertissement environ 1 semaine avant ; restauration possible 1 an selon le texte de la documentation (sa page est incohérente). **Aucune garantie** qu'une sauvegarde quotidienne compte comme activité suffisante |
| **Sortie : 5 Go non cachée + 5 Go cachée par mois**, par organisation | Notre trafic base → serveur est de la sortie non cachée, estimé ≈ 0,03 Go/mois en usage normal, ≈ 0,3 à 1 Go dans le pire cas de relecture périodique. Au dépassement : restrictions de l'organisation jusqu'au cycle suivant |
| **Connexions (calcul « Nano », plan gratuit)** | D'après le tableau de la documentation officielle : **60 connexions directes, 200 clients du pooler**. Le serveur ouvre **5 connexions au plus** par défaut sur une base gérée, le job de sauvegarde 2 : très en dessous. **Non confirmé** : la taille du pool côté serveur du pooler en mode session sur le plan gratuit (un client en mode session occupe une connexion du serveur jusqu'à sa déconnexion), à lire dans vos paramètres de base de données |
| **Pas de sauvegarde automatique** (Free) | Remplacée par notre job (§5) |
| **Pas d'engagement de disponibilité** | |
| **API de données de Supabase** | Elle expose le schéma `public` ; SmartCourse n'y est jamais (schéma dédié), et est en plus verrouillée (§6). Ne jamais utiliser ni publier les clés `anon` / `service_role` |

## 5. Sauvegardes indépendantes, restauration complète vérifiée

Fichier : `.github/workflows/backup-externe.yml`. À chaque exécution :
1. lit la version majeure de PostgreSQL de Supabase et installe le client `pg_dump` de la même version ;
2. démarre un **PostgreSQL jetable de la même version** (conteneur du coureur GitHub), jamais la base de production ;
3. **copie d'abord les photos de la famille** dans le stockage indépendant ;
4. sauvegarde le **seul schéma SmartCourse** (instantané unique, manifeste des comptages), **chiffre** (le fichier stocké doit être chiffré, sinon échec) et dépose le fichier ;
5. **restaure** la sauvegarde dans le serveur jetable, déchiffrée avec la clé, et la compare au manifeste : comptage de chaque table, migrations, invariants métier ;
6. **vérifie les photos sur la base restaurée** : chaque photo de famille qu'elle liste doit exister dans la sauvegarde, avec la **même empreinte SHA-256 et la même taille** que celles enregistrées, et s'ouvrir comme une image ; **copier ne suffit pas** : une photo absente, altérée ou illisible rend la sauvegarde invalide ;
7. n'applique la rétention (7 quotidiennes, 4 hebdomadaires, 3 mensuelles) qu'après une vérification complète réussie ;
8. écrit le résultat dans `backup_runs` : **Réglages → Profils** affiche la dernière restauration vérifiée ; l'application consigne une erreur si aucune n'a eu lieu depuis 36 h, et l'écran passe en orange après 3 jours.

Ce job **ne migre jamais** la base de production et n'y change aucun droit.

**Secrets GitHub** (Settings → Secrets and variables → Actions → Secrets) : `DATABASE_URL` (pooler **session**, port 5432), `DATABASE_SSL_CA`, `BACKUP_KEY`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, et pour les photos `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (accès au bucket d'images Railway). **Variable** : `BACKUP_EXTERNE_ACTIVE=true`, à créer seulement après la validation (§8).

**Dépôt public** : les journaux sont publics. Le job n'imprime ni adresse de base, ni noms de bucket, ni clé, ni contenu ; GitHub masque les secrets. Les secrets ne sont pas transmis aux exécutions déclenchées depuis un fork.

**Sauvegardes internes de l'application** : conservées (mode par défaut `internal`) pour une base ordinaire, mais **impossibles sur Supabase** : le serveur refuse de démarrer (§6). Rien n'est désactivé sans remplacement : le remplacement est ce job.

**Restauration en cas de sinistre** (à répéter une fois par mois) : télécharger la dernière sauvegarde `.dump.enc` ; la déchiffrer avec `BACKUP_KEY` (fonction `decrypt` de `server/src/backup.ts`) ; `pg_restore --no-owner --dbname=<nouvelle base de la même version>` ; recopier `photos/` vers le bucket d'images ; pointer `DATABASE_URL` et `DATABASE_SCHEMA` sur la nouvelle base.

## 6. Adaptations du code (testées en local : 149 tests serveur)

| Exigence | Réalisation | Test |
|---|---|---|
| **La protection ne concerne que SmartCourse** | SmartCourse vit dans son **propre schéma** (`DATABASE_SCHEMA=smartcourse`) : migrations, tables, sauvegarde (`--schema`) et verrouillage n'agissent **que** sur ce schéma. Les rôles `anon`/`authenticated` y perdent tous les droits et la sécurité par ligne y est activée ; le schéma `public`, les tables d'autres applications et tous les schémas gérés par Supabase ne sont ni lus, ni modifiés, ni sauvegardés. Les noms de schéma réservés (`auth`, `storage`, `extensions`, `graphql_public`, `realtime`, `pg_*`…) sont refusés | Test : une table d'« une autre application » dans `public`, avec droits ouverts et sans RLS, reste **strictement identique** (droits, RLS, liste des tables) ; nos tables sont toutes dans le schéma dédié et verrouillées ; la sauvegarde ne contient pas l'autre table ; la restauration de contrôle retrouve le schéma entier |
| **Erreur claire si la configuration est incorrecte (Supabase)** | Le démarrage s'arrête **avant toute connexion** si : le mode de sauvegarde n'est pas `external` (message : sauvegardes internes incompatibles) ; le schéma est `public` ou réservé ; le certificat `DATABASE_SSL_CA` manque ; le port est 6543 (pooler en mode transaction) | Tests sur chacun des messages |
| **Connexion sécurisée** | Chiffrée **et** vérifiée avec le certificat racine ; `pg_dump` en `verify-full` | Vrai TLS local : accepté / refusé sans certificat / refusé avec un autre |
| **Sauvegarde externe** | Serveur de contrôle distinct de même version majeure, stockage dédié, chiffrement contrôlé, photos copiées puis vérifiées après restauration | Tests : restauration vers une autre base, mauvais accès refusé, photo absente / altérée détectée, fichier non chiffré refusé, mauvaise clé refusée |
| Connexions | 5 au plus par défaut sur une base gérée (`DATABASE_POOL_MAX`) | Test |

## 7. Stockage de sauvegarde : une seule recommandation, **Backblaze B2, sans carte bancaire**

| | Backblaze B2 (recommandé) | Cloudflare R2 (non retenu) |
|---|---|---|
| Gratuit | 10 Go de stockage ; sortie gratuite jusqu'à 3 × le stockage moyen (page tarifaire Backblaze) | 10 Go-mois, 1 M d'opérations A, 10 M d'opérations B par mois, sortie gratuite (documentation Cloudflare) |
| Compte sans carte | **Oui** d'après le blog officiel de Backblaze (« you don't need to give us a credit card to create an account ») | Une source tierce affirme qu'une carte est exigée pour activer R2 ; non confirmé par Cloudflare |
| **Risque de facturation** | **Nul tant que vous n'ajoutez aucune carte** : il est impossible de vous facturer | **Réel** si une carte est enregistrée : dépassement facturé automatiquement (opérations A à 4,50 $ par million, selon Cloudflare), même si nos volumes sont très loin du gratuit |
| API S3 | Oui | Oui |

**Conditions et incertitudes** : nous sauvegardons ≈ 1 fois par jour (quelques centaines de Ko, 14 fichiers conservés) : < 0,1 Go et quelques centaines d'opérations par jour. Je n'ai pas pu confirmer qu'un compte B2 **sans carte** a accès à l'API S3 et aux clés d'application, ni la règle exacte des appels d'API gratuits (la page officielle et des sources plus anciennes divergent). **Si, à l'inscription, Backblaze exige une carte : ne la donnez pas, arrêtez-vous et dites-le-moi** (alternative à discuter alors).

**À l'ouverture du compte (après votre accord)** : bucket **privé**, région Europe si proposée, une **clé d'application limitée à ce bucket** (lecture, écriture, liste, suppression), jamais la clé principale ; aucun réglage de facturation à activer.

## 8. Ce qui est validé, et ce qui ne l'est pas

**Validé en local seulement** (PostgreSQL 16 de développement, stockage de fichiers local) : le code, les garde-fous, l'isolation de schéma, la protection, le chiffrement, la restauration vers une autre base, la vérification des photos, les messages d'erreur.

**NON validé sur les vrais services** (rien n'existe encore) — à faire avant la mise en production, dans l'ordre :
1. **Supabase** : connexion par le pooler en mode session avec le vrai certificat racine (nom d'hôte du pooler) ; création du schéma `smartcourse` et exécution des migrations par le rôle `postgres` ; protection des tables (droits de `postgres` pour la RLS et les droits par défaut) ; version de PostgreSQL ; lecture de la taille du pool du pooler.
2. **Bucket Railway** : écriture, lecture, suppression d'images ; lecture **depuis GitHub** (accès externe) pour copier les photos.
3. **Backblaze B2** : compatibilité de notre client S3 (envoi, liste, lecture, suppression), clé limitée au bucket.
4. **Job de sauvegarde** : un lancement **manuel** (Actions → « Sauvegarde externe » → Run workflow) qui doit afficher : *photos copiées*, *restauration vérifiée (n tables, fichier chiffré, déchiffré avec la clé)*, *photos vérifiées après restauration*. Puis, **de vos propres yeux** : le fichier présent dans B2 et illisible en clair, l'état dans Réglages. Seulement après : créer `BACKUP_EXTERNE_ACTIVE=true`.
5. **Test de sinistre une fois** : restaurer cette sauvegarde dans une base d'essai et ouvrir l'application dessus.

## 9. Branche par défaut et planification

Constat (API GitHub) : **la branche par défaut de votre dépôt est déjà `claude/family-shopping-list-specs-eqevg8`**, qui est aussi la seule branche ; il n'y a ni `main` ni demande de fusion. GitHub n'exécute le déclencheur planifié que pour le fichier de la branche par défaut : **la planification est donc déjà possible sans fusion**. Pour éviter des échecs chaque nuit avant que tout soit prêt, la planification est **désactivée par défaut** (variable `BACKUP_EXTERNE_ACTIVE`, §5).

Points à connaître :
- **Un dépôt public désactive les workflows planifiés après 60 jours sans activité** (documentation GitHub) : une mise en veille longue du dépôt arrêterait les sauvegardes sans bruit. Garde-fous : l'écran Réglages passe en orange après 3 jours sans restauration vérifiée, le serveur consigne une erreur après 36 h ; à surveiller, ou rendre le dépôt privé (alors 2 000 minutes gratuites par mois, ce qui suffit, et pas de désactivation à 60 jours).
- Tout commit sur la branche par défaut change le code exécuté par le job planifié. Recommandé (facultatif, à votre décision) : **renommer la branche par défaut en `main`** (Settings → Branches → icône de crayon) et ne déployer que depuis elle ; GitHub redirige les anciens liens. Je ne le fais pas sans votre accord.
- Le dépôt est **public** : il contient vos documents de budget et de limites Railway (sans secret). À vous de décider si vous le voulez public.

## 10. Mise en service : liste d'étapes (rien n'est exécuté)
1. **Vous** : captures Railway et Supabase (G1, G2) ; accord sur Backblaze B2 (G3).
2. **Vous** : créer le projet Supabase (Europe, mot de passe fort) ; relever l'URL du **pooler en mode session**, le certificat racine ; ne m'envoyez aucun mot de passe.
3. **Vous** : créer le compte B2 **sans carte**, le bucket privé et la clé limitée ; créer les secrets GitHub.
4. Valider sur les vrais services (§8, points 1 à 5), puis créer `BACKUP_EXTERNE_ACTIVE=true`.
5. Après votre accord écrit : service Railway + bucket, avec `DATABASE_URL`, `DATABASE_SSL_CA`, `DATABASE_SCHEMA=smartcourse`, `BACKUP_MODE=external`, `S3_*`, `INSTALL_TOKEN`.
6. Premier démarrage : journaux « Tables protégées contre l'API de données », « Images du catalogue : 80 », `/health` ; puis `scripts/check-tunnel.mjs` sur l'adresse Railway.
7. Première installation, suppression de `INSTALL_TOKEN`, profils, **recette sur le vrai Android** avec l'adresse stable.
8. **Une semaine de mesure** (usage Railway, sortie et taille Supabase, sauvegardes quotidiennes), puis mise à jour de `couts.md`.
