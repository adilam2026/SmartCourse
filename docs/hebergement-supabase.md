# Hébergement choisi : Railway (serveur) + Supabase Free (base PostgreSQL)

**Statut : adaptations du code faites et testées EN LOCAL ; rien n'est créé, rien n'est déployé, aucun abonnement, aucune limite Railway modifiée.** Les essais locaux ne valident ni Supabase, ni le bucket Railway, ni le stockage de sauvegarde : voir §8 pour ce qui reste à valider sur les vrais services.

## 1. Portes à franchir avant toute création de service

| # | Condition | État |
|---|---|---|
| G1 | **Un projet Supabase Free est disponible** (moins de 2 projets Free actifs, toutes organisations dont vous êtes propriétaire ou administratrice confondues) | **Non vérifiable par moi** (aucun accès à votre compte) : captures attendues |
| G2 | **Consommation de votre workspace Railway** (U) | Captures attendues : le coût total reste conditionnel |
| G3 | **Stockage de sauvegarde indépendant** : Backblaze B2 est un **candidat, non retenu** tant que trois points ne sont pas confirmés (§7) | Non créé |
| G3b | **Alerte extérieure** (Healthchecks.io, §5) créée et testée | Non créée |
| G4 | **Validation sur les vrais services** (§8) : un lancement manuel du job de sauvegarde externe réussi, avec restauration complète vérifiée | **Non réalisée** : aucun service réel n'existe encore |
| G5 | Variable de dépôt `BACKUP_EXTERNE_ACTIVE=true` créée **après** G4 (sinon la planification reste inactive) | À faire après G4 |
| G6 | Votre accord écrit sur la mise en service | En attente |

## 2. Où seront les données

| Donnée | Emplacement | Pourquoi |
|---|---|---|
| Base PostgreSQL | **Supabase Free**, projet en Europe, **schéma `smartcourse` (jamais `public`)** | Pas de service PostgreSQL payant ; isolation des autres applications |
| Serveur (API + application installable) | **Railway**, 1 service, domaine HTTPS stable fourni par Railway | |
| Images (80 visuels + images ajoutées par la famille) | **Bucket Railway** (`S3_*`) | < 0,05 Go, < 0,01 $ par mois d'après les tarifs relevés |
| Sauvegardes de la base (chiffrées AES-256-GCM) et copie des photos de la famille | **Backblaze B2 (candidat, non retenu à ce stade, §7)** : un bucket privé, une clé d'accès limitée à ce bucket | Indépendant de Railway et de Supabase |
| `BACKUP_KEY` | Votre gestionnaire de mots de passe **et** secret GitHub du job. **Pas** dans Railway : le serveur n'en a pas besoin en mode externe | Sans elle, les sauvegardes sont illisibles |

## 3. Coût total estimé (conditionnel à U)

Estimations d'après des mesures locales ; tarifs Railway issus de sources secondaires concordantes, **à reconfirmer sur votre page Usage**. Ce ne sont pas des seuils garantis.

| Poste (par mois) | Estimation |
|---|---|
| Service Railway (≈ 0,11 Go de mémoire, CPU quasi nul) | ≈ 1,2 à 1,6 $ (jusqu'à ≈ 2,5 $ en fourchette prudente) |
| Bucket Railway (images) | < 0,01 $ |
| Supabase Free | 0 $ |
| Backblaze B2 (< 10 Go gratuits ; nos sauvegardes pèseront quelques dizaines de Mo) | 0 $ |
| **GitHub Actions** | **0 $ tant que le dépôt est PUBLIC** (vérifié par l'API GitHub) : selon la documentation GitHub, les exécuteurs standard y sont gratuits. Voir l'estimation des minutes ci-dessous (utile seulement si le dépôt devenait privé) |
| **Application** | **≈ 1,2 à 1,7 $ (prudent : jusqu'à ≈ 2,6 $)** |

Total Railway = U + application, et vous ne payez que le dépassement des 5 $ inclus. **Je ne connais pas U.** Scénarios (estimatifs, pas des limites) :

| Si U vaut… | Total estimé | Total « prudent » |
|---|---|---|
| 1 $ | ≈ 2,2 à 2,7 $ | ≈ 3,6 $ |
| 2 $ | ≈ 3,2 à 3,7 $ | ≈ 4,6 $ |
| 3 $ | ≈ 4,2 à 4,7 $ | ≈ 5,6 $ : dépassement possible |
| 4 $ ou plus | ≈ 5,2 $ ou plus | dépassement probable |

### Minutes GitHub Actions : estimation à partir des durées réelles (le job de sauvegarde n'a jamais tourné)

| Mesure | Valeur | Origine |
|---|---|---|
| Vérification Docker n° 8 : job `verify` / job `recette-locale` | ≈ 57 s / ≈ 47 s | **réelle** (API GitHub) |
| Vérification du tunnel n° 6 (démarrage ≈ 1 min + contrôles ≈ 2 min) | ≈ 3 min | **réelle** |
| `npm ci` + construction du serveur | 12,7 s + 1,2 s | mesurée **en local** (les exécuteurs GitHub peuvent différer) |
| Sauvegarde + restauration de contrôle + photos, base de 9 Mo | 2,6 s | mesurée **en local** |
| Installation du client `pg_dump` (dépôt PGDG), téléchargement et démarrage de `postgres` jetable, `actions/setup-node` | ≈ 1 à 2 min au total | **non mesurée** : estimation |

Estimation du job complet : **≈ 2 à 3 minutes**, arrondies à la minute facturée par GitHub, soit **≈ 60 à 90 minutes par mois** pour 30 exécutions. **Ce n'est qu'une estimation** : la première exécution manuelle donnera la durée réelle (page de l'exécution : « Total duration »). Dépôt public : aucune minute n'est facturée. Si le dépôt devenait privé (GitHub Free : 2 000 minutes par mois d'après la documentation GitHub), je ne conclurai qu'après avoir lu cette durée réelle ; seuil de réexamen : plus de 6 minutes par exécution (≈ 180 minutes par mois avec les autres vérifications).

Aucun scénario ne garantit le zéro dépassement : seule une semaine de mesure après mise en service le dira. Vos limites (alerte 5 $, plafond 10 $, AGENT 0 $) ne sont pas modifiées.

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

### Photos créées ou remplacées pendant la sauvegarde : jamais d'ensemble incohérent
- Une photo est **immuable et nommée par son contenu** : « modifier » une photo en crée une nouvelle, l'ancienne n'est jamais réécrite sur place.
- Le fichier est écrit **avant** que sa ligne soit validée dans la base : toute ligne visible par un instantané a déjà son fichier.
- La sauvegarde liste ses photos **dans le même instantané que le dump** (`manifest.photos`) ; elle copie d'abord tout ce qui existe (phase A), puis, après l'instantané, ce que l'instantané liste et qui manque encore (phase B) ; la base restaurée doit lister **exactement** ces photos. Une photo créée après l'instantané appartient à la sauvegarde suivante.
- Seule faille résiduelle : une photo listée par l'instantané dont le fichier disparaît avant la phase B (remplacée **et** purgée en quelques minutes ; la purge n'agit que sur des images de plus de 10 minutes sans aucune référence). Elle est **signalée, la sauvegarde est déclarée invalide, les anciennes sont conservées**, la suivante la répare.
- Testé : photo créée entre la phase A et l'instantané, après l'instantané, remplacée pendant la sauvegarde, fichier disparu avant la copie, liste différente du manifeste.

### Alerte extérieure à l'application si les sauvegardes cessent
L'écran Réglages et le journal du serveur ne suffisent pas : ils ne voient rien si personne ne les regarde, ni si la tâche ne se lance plus (workflow désactivé après 60 jours sans activité dans un dépôt public, panne de GitHub). **Recommandation : un moniteur de « battement de cœur » indépendant, Healthchecks.io** (formule gratuite « Hobbyist » à 0 $, 20 contrôles, **sans carte bancaire** d'après sa page tarifaire : à confirmer à l'inscription ; ce n'est pas un engagement contractuel).
- Le job envoie un signal au **départ**, au **succès** (`HEALTHCHECK_URL`) et à l'**échec** (`/fail`) ; si Healthchecks ne reçoit **aucun signal** dans la période prévue, **il vous alerte lui-même** : cela couvre l'échec, l'absence d'exécution, un workflow désactivé et une panne GitHub.
- Réglage à faire par vous : période **1 jour**, délai de grâce **6 heures**, canal **e-mail** (ajoutez-en un second, par exemple Telegram, pour ne pas dépendre d'une seule boîte).
- Le secret `HEALTHCHECK_URL` est **obligatoire pour les exécutions planifiées** (sinon le job refuse de tourner) ; il est facultatif pour l'essai manuel, avec un avertissement.
- À valider une fois : (1) un lancement manuel → le contrôle passe au vert ; (2) un échec volontaire (secret erroné) → alerte reçue ; (3) aucun signal pendant plus de la période + grâce → alerte reçue.
- **Limites** : un moniteur de plus à maintenir (compte à créer **après votre accord**) ; si GitHub **et** Healthchecks étaient en panne en même temps, aucune alerte ; le plan gratuit ne garantit pas la disponibilité.

**Secrets GitHub** (Settings → Secrets and variables → Actions → Secrets) : `DATABASE_URL` (pooler **session**, port 5432), `DATABASE_SSL_CA`, `BACKUP_KEY`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, et pour les photos `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (accès au bucket d'images Railway), et **`HEALTHCHECK_URL`** (adresse de signal du moniteur, obligatoire pour la planification). **Variable** : `BACKUP_EXTERNE_ACTIVE=true`, à créer seulement après la validation (§8).

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

## 7. Stockage de sauvegarde : Backblaze B2 est un candidat, **pas encore retenu**

Les pages officielles de Backblaze ne sont pas ouvrables depuis mon environnement (le site est inaccessible) : ce qui suit vient d'**extraits de leurs pages officielles obtenus par recherche**, pas d'une lecture directe des pages.

| Question | Ce que disent les sources officielles lues | Statut |
|---|---|---|
| **Compte sans carte** | La page d'inscription et le blog officiel indiquent qu'**aucune carte n'est requise pour créer un compte** (e-mail, vérification, mot de passe, région) | Affirmé par Backblaze pour **la création**. **Ce n'est pas une garantie contractuelle** : une page d'inscription n'est pas un contrat et peut changer |
| **API S3 et clés d'application sans carte** | La documentation officielle des clés dit : la clé principale n'est **pas** compatible S3 ; il faut créer une **clé d'application**, utilisable avec l'API S3 et l'API native ; une clé **limitée à un bucket** exige la capacité `listAllBucketNames` pour les SDK, **ne peut ni créer ni supprimer de bucket** (le bucket se crée avec l'interface ou une clé plus large) | Fonctionnement des clés **confirmé**. **Aucune page lue ne dit si un compte sans carte y a accès** : **non confirmé** |
| **Quotas gratuits atteints** | Les « plafonds » (caps) sont des **limites de dépense quotidiennes en dollars** fixées par le client (stockage, opérations A, B, C), remise à zéro à 00 h GMT, alertes à 75 % et 100 % ; **sans plafond, l'usage est illimité et des frais illimités peuvent s'accumuler**. Le gratuit est de 10 Go de stockage ; la page tarifaire (résumée) indique des appels A, B et C gratuits pour les comptes à l'usage | **Ce que devient un compte sans carte au-delà des 10 Go ou des opérations gratuites (blocage, demande de carte, facturation différée) n'est pas écrit dans les pages lues : non confirmé** |
| **Durée du compte gratuit** | Aucune page lue n'indique d'expiration du gratuit. Les conditions d'utilisation réservent à Backblaze le droit de **suspendre ou résilier** un compte et d'en **supprimer les données** en cas de non-paiement ou de violation des conditions ; l'aide parle de la suppression d'un compte « inactif » | **Règle d'inactivité d'un compte gratuit non trouvée : non confirmé** |

**Conclusion : je ne retiens pas B2 comme validé.** Trois points restent non confirmés par une source officielle (accès d'un compte sans carte, comportement au dépassement, durée de vie). Marche proposée, **sans engager de données réelles** :
1. **Essai décisif**, après votre accord : créer le compte **sans carte**, un bucket privé, une clé d'application limitée à ce bucket (avec `listAllBucketNames`), puis lancer le workflow manuel. **Si une étape exige une carte ou échoue, B2 est écarté.**
2. **Question écrite au support Backblaze** avant de s'y fier : « Un compte B2 créé sans carte bancaire : (1) peut-il créer des clés d'application compatibles S3 ? (2) que se passe-t-il quand le stockage dépasse 10 Go ou que les opérations dépassent le gratuit : requêtes refusées, facturation, demande de carte ? (3) existe-t-il une durée, une règle d'inactivité ou une suppression de données pour les comptes gratuits ? » Réponse écrite à conserver.
3. Risques résiduels qui subsistent même si tout passe : suppression ou suspension du compte sans préavis connu ; d'où l'**alerte extérieure** (§5) et un **test de restauration mensuel**.

**Alternative** si B2 est écarté : Cloudflare R2 (10 Go gratuits, 1 M d'opérations A et 10 M d'opérations B par mois, sortie gratuite, d'après la documentation Cloudflare) ; une carte semble requise (source tierce, non confirmée) et le dépassement est alors facturé automatiquement (opérations A à 4,50 $ le million) : risque de facturation **réel mais très faible** avec nos volumes. À discuter seulement si B2 est écarté. Rien n'est créé avant votre accord.

## 8. Ce qui est validé, et ce qui ne l'est pas

**Validé en local seulement** (PostgreSQL 16 de développement, stockage de fichiers local) : le code, les garde-fous, l'isolation de schéma, la protection, le chiffrement, la restauration vers une autre base, la vérification des photos, les messages d'erreur.

**NON validé sur les vrais services** (rien n'existe encore) — à faire avant la mise en production, dans l'ordre :
1. **Supabase** : connexion par le pooler en mode session avec le vrai certificat racine (nom d'hôte du pooler) ; création du schéma `smartcourse` et exécution des migrations par le rôle `postgres` ; protection des tables (droits de `postgres` pour la RLS et les droits par défaut) ; version de PostgreSQL ; lecture de la taille du pool du pooler.
2. **Bucket Railway** : écriture, lecture, suppression d'images ; lecture **depuis GitHub** (accès externe) pour copier les photos.
3. **Backblaze B2** (essai décisif du §7) : compatibilité de notre client S3 (envoi, liste, lecture, suppression), clé limitée au bucket, aucune carte demandée.
4. **Job de sauvegarde** : un lancement **manuel** (Actions → « Sauvegarde externe » → Run workflow) qui doit afficher : *photos copiées*, *restauration vérifiée (n tables, fichier chiffré, déchiffré avec la clé)*, *photos vérifiées après restauration*. Puis, **de vos propres yeux** : le fichier présent dans B2 et illisible en clair, l'état dans Réglages. Seulement après : créer `BACKUP_EXTERNE_ACTIVE=true`.
5. **Alerte extérieure** : les trois essais du §5 (succès, échec volontaire, absence de signal).
6. **Test de sinistre une fois** : restaurer cette sauvegarde dans une base d'essai et ouvrir l'application dessus.

## 9. Branche par défaut et planification

Constat (API GitHub) : **la branche par défaut de votre dépôt est déjà `claude/family-shopping-list-specs-eqevg8`**, qui est aussi la seule branche ; il n'y a ni `main` ni demande de fusion. GitHub n'exécute le déclencheur planifié que pour le fichier de la branche par défaut : **la planification est donc déjà possible sans fusion**. Pour éviter des échecs chaque nuit avant que tout soit prêt, la planification est **désactivée par défaut** (variable `BACKUP_EXTERNE_ACTIVE`, §5).

Points à connaître :
- **Un dépôt public désactive les workflows planifiés après 60 jours sans activité** (documentation GitHub) : une mise en veille longue du dépôt arrêterait les sauvegardes sans bruit. Garde-fous : l'écran Réglages passe en orange après 3 jours sans restauration vérifiée, le serveur consigne une erreur après 36 h ; à surveiller, ou rendre le dépôt privé (alors 2 000 minutes gratuites par mois, ce qui suffit, et pas de désactivation à 60 jours).
- Tout commit sur la branche par défaut change le code exécuté par le job planifié. Recommandé (facultatif, à votre décision) : **renommer la branche par défaut en `main`** (Settings → Branches → icône de crayon) et ne déployer que depuis elle ; GitHub redirige les anciens liens. Je ne le fais pas sans votre accord.
- Le dépôt est **public** : il contient vos documents de budget et de limites Railway (sans secret). À vous de décider si vous le voulez public.

## 10. Mise en service : liste d'étapes (rien n'est exécuté)
1. **Vous** : captures Railway et Supabase (G1, G2) ; accord sur Backblaze B2 (G3).
2. **Vous** : créer le projet Supabase (Europe, mot de passe fort) ; relever l'URL du **pooler en mode session**, le certificat racine ; ne m'envoyez aucun mot de passe.
3. **Vous** (après accord) : essai décisif B2 **sans carte** (§7), bucket privé, clé limitée ; compte Healthchecks.io ; secrets GitHub.
4. Valider sur les vrais services (§8, points 1 à 5), puis créer `BACKUP_EXTERNE_ACTIVE=true`.
5. Après votre accord écrit : service Railway + bucket, avec `DATABASE_URL`, `DATABASE_SSL_CA`, `DATABASE_SCHEMA=smartcourse`, `BACKUP_MODE=external`, `S3_*`, `INSTALL_TOKEN`.
6. Premier démarrage : journaux « Tables protégées contre l'API de données », « Images du catalogue : 80 », `/health` ; puis `scripts/check-tunnel.mjs` sur l'adresse Railway.
7. Première installation, suppression de `INSTALL_TOKEN`, profils, **recette sur le vrai Android** avec l'adresse stable.
8. **Une semaine de mesure** (usage Railway, sortie et taille Supabase, sauvegardes quotidiennes), puis mise à jour de `couts.md`.
