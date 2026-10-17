# Évolutions avancées — document de suivi

Spécification consolidée du 17/10/2026 (elle remplace les consignes antérieures en cas de contradiction).
Branche de travail : `claude/evolutions-avancees`. Aucune publication Google Play automatique.

## 1. Version de départ (référence)

| Élément | Valeur |
|---|---|
| Application Android livrée | versionName **1.0.2**, versionCode **1144**, identifiant `app.smartcourse.courses.natif` |
| Commit de l'application | `f5c3335` (branche `claude/android-native`, résultats de recette en `a1054bb`) |
| Référence Git | branche `reference/android-1.0.2-1144` (→ `f5c3335`). Les tags Git ne peuvent pas être poussés depuis la session : le tag annoté `ref-android-1.0.2-1144` existe seulement en local ; la branche de référence le remplace. |
| APK | https://github.com/adilam2026/SmartCourse/releases/download/courses-natif-play-1.0.2-44/MesCourses-1.0.2-depuis-bundle.apk |
| AAB | https://github.com/adilam2026/SmartCourse/releases/download/courses-natif-play-1.0.2-44/MesCourses-1.0.2.aab |
| Release GitHub | `courses-natif-play-1.0.2-44` (pré-version, non publiée sur Google Play) |
| Certificat (clé durable) | SHA-256 `C2:CB:CE:5E:2F:61:8A:21:7A:C6:7A:15:A7:2C:E2:0F:BB:B3:B9:80:BC:3B:AF:43:DD:8A:4A:EA:E6:69:C8:8E` |
| Serveur compatible | production `f460829` (branche `claude/family-shopping-list-specs-eqevg8`), référence `reference/serveur-022` |
| Migrations appliquées | `001` à `022_family_products_proposals.sql` (constaté sur `/health` le 17/10/2026) |

### Fonctions et parcours déjà livrés (à conserver)
- Liste unique active, ajout d'articles, demandes du personnel, achats, clôture, historique, Recommander (choix Ajouter / Remplacer si la liste n'est pas vide), favoris, statistiques.
- Sélection : Liste / Cartes, Tous les articles / Par catégories, commande Affichage dans l'en-tête, préférences par profil, badges numériques des catégories ; la sélection reprend la liste en cours (sans doublon ni cumul).
- Produits : recherche ouverte à tous ; création seulement depuis le Catalogue après vérification de tout le catalogue (actif, masqué, disponible, familial), jamais hors connexion ; proposition facultative au catalogue commun ; espace `/gestion` réservé aux gestionnaires.
- Codes d'accès : 6 chiffres, clavier numérique, afficher/masquer, anciens codes à lettres acceptés à la connexion ; partage de l'accès d'un membre ; code famille retenu.
- Création de famille autonome (e-mail vérifié), ville marocaine (146 villes normalisées), suppression de compte / de famille, transfert de l'administrateur principal.
- Prix indicatifs (Maroc), prix familiaux, prix communautaires par ville, totaux estimés.
- Notifications d'activité Android (vérification périodique ~15 min, sans service Google), Web Push côté site.

### Sauvegarde de la base
Le serveur fait une sauvegarde chiffrée quotidienne (pg_dump + manifeste + photos, rétention 7 j / 4 sem. / 3 mois) **si** le stockage S3 est configuré, et vérifie la restauration dans une base de contrôle.
**Non vérifié depuis la session** (l'état est réservé à un administrateur connecté : `GET /api/admin/backup-status`). Bloquant avant toute migration : voir § 6.

## 2. Exigences (numérotation de la spécification)

| N° | Exigence | État |
|---|---|---|
| 1 | Sécuriser la version actuelle (référence, suivi, sauvegarde, retour arrière) | En cours : référence et suivi faits ; sauvegarde à confirmer |
| 2 | Hors périmètre (paiement commercial, iPhone, chiffrement avancé, banque, OCR, devises) | Respecté |
| 3 | Paramètres avancés : Plusieurs listes actives, Gestion du budget (désactivées par défaut, administrateurs, synchronisées) | Développé : les deux options (branche `claude/evolutions-avancees`) |
| 4 | Pays / ville de la famille, prix indicatifs seulement au Maroc, devise du budget | Développé : migration 023, écran « Pays et ville », prix masqués hors Maroc ; devise proposée selon le pays, confirmée, figée dès la première opération |
| 5 | Codes d'accès de 6 à 8 chiffres | Développé (serveur, web, Android), tests serveur et unitaires Android |
| 6 | Connexion / inscription avec Google | **Retiré de cette livraison** (décision du 17/10/2026) : ni bouton, ni SDK, ni configuration OAuth. Authentification classique conservée. |
| 7 | Notifications d'activité et rappels d'achat personnels | Développé (Android) : jours, horaires, rappel groupé, sans alarme exacte ; les rappels peuvent être différés par Android (aucun délai garanti) |
| 8 | Plusieurs listes actives (option) | Développé : migration 024, sélecteur de liste, nouvelle liste nommée, Recommander vers une liste choisie |
| 9 | Affichage : conserver les choix validés | Déjà livré, à conserver |
| 10 | Création de produits après vérification du catalogue complet | Déjà livré (1143-1144), à conserver |
| 11 | Cohérence liste ↔ sélection | Déjà livré (1143) ; la sélection suit la liste consultée |
| 12-19 | Module Budget (paiements, clôture, opérations, budgets, Mon compte, écrans, exactitude) | Développé après validation des principes (17/10/2026) : migration 025, serveur et Android |
| 20 | Permissions financières distinctes, appliquées côté serveur | Développé : gérer / consulter / saisir les paiements / modifier ; personnel limité à la saisie des paiements ; vérifié par le serveur |
| 21 | Exemples de référence | Tests automatiques du serveur (900 DH ; 1 850 / 950 / 103 150 / 5 100 ; correction 450 → 400) : réussis |
| 22 | Maquettes, étapes, contrôles ciblés | Étapes (a) à (d) développées ; contrôles ciblés en cours |
| 23 | Livraison et retour arrière | À la fin |

## 3. Écarts entre le code actuel et la spécification

| Domaine | Aujourd'hui | Attendu | Travail |
|---|---|---|---|
| Réglages | Pas de rubrique avancée, pas de réglage familial (table `families` sans options) | Rubrique « Paramètres avancés », 2 options familiales | Colonnes ou table d'options familiales (migration additive), écran, droits admin |
| Listes | Index unique « une liste active par famille » (`005`), API `/api/lists/active`, moteur Android à liste unique | Option multi-listes nommées | Lever l'index **seulement** via une règle serveur selon l'option ; nom de liste ; liste courante par profil ; API par identifiant ; l'ancienne API reste (liste par défaut) |
| Localisation | Ville par profil (`profiles.city`), Maroc seulement, pas de pays | Pays + ville **de la famille**, héritage par les membres | Colonnes `families.country`, `families.city` ; reprise prudente ; formulaires |
| Prix | Affichés selon préférence par profil, partout | Seulement au Maroc | Masquage selon le pays (application et serveur) |
| Codes | Exactement 6 chiffres (serveur et application) | 6 à 8 chiffres pour les nouveaux codes | `NEW_SECRET_PATTERN`, règle « code faible », champs, textes |
| Google | Aucun | Hors livraison | Rien |
| Notifications | Activité seulement, réglage local par profil | + rappels personnels (jours, horaires) | Alarmes Android, réglages, état système |
| Budget | Aucun | Module complet facultatif | Tables d'opérations, budgets, compte ; droits ; écrans |
| Permissions | Rôles fixes admin / parent / personnel | + droits financiers distincts | Table de droits par profil, contrôles serveur |
| Sauvegarde | Planifiée si S3 configuré | Sauvegarde restaurable avant migration | Confirmation (§ 6) |

## 4. Décisions

Validées le 17/10/2026 :
1. **Codes d'accès** : 6 à 8 chiffres pour tout nouveau code, consigne « Entre 6 et 8 chiffres » visible partout où un code est choisi ; anciens codes (6 caractères, lettres comprises) toujours acceptés à la connexion ; personne n'est obligé de changer de code.
2. **Mon compte** : le solde initial est l'argent disponible **au début** de la date de référence ; les opérations datées de ce jour et des jours suivants sont comptées.
3. **Finances et personnel** : droits financiers distincts par profil ; aucun accès par défaut pour le personnel ; un administrateur peut accorder « saisir les paiements des courses » sans voir solde, entrées ni autres dépenses.
4. **Devise** : proposée selon le pays, confirmée à l'activation, figée dès la première opération.
5. **Rappels** : sans permission d'alarme exacte ; décalage possible de quelques minutes, indiqué à l'écran.
6. **Familles existantes** : le Maroc n'est jamais supposé. Si la ville déjà connue est reconnue, pays et ville sont préremplis ; dans tous les cas l'administrateur confirme. Sans confirmation, pas de pays : les prix restent affichés comme aujourd'hui (aucun changement de comportement imposé).
7. **Google** : retiré de cette livraison.

Proposées et appliquées sauf avis contraire :
8. Ordre : (a) codes 6-8 ; (b) pays/ville et prix ; (c) paramètres avancés + rappels ; (d) plusieurs listes ; (e) budget (après validation visuelle de ses maquettes).
9. Montants en centimes entiers ; identifiant de requête sur chaque saisie financière (pas de doublon en cas de relance).

## 5. Contrôles effectués
- 17/10/2026 : maquettes des nouveaux parcours (22 écrans, puis 21 après retrait de Google) : https://claude.ai/artifact/B1cei82u74Zfo3upEbrs7h — en attente de validation.
- 17/10/2026 : production `/health` = `f460829`, migration `022`. Référence Git créée (`reference/android-1.0.2-1144`, `reference/serveur-022`). Analyse du code (listes, notifications, localisation, codes, prix, sauvegardes, rôles, authentification).

- 17/10/2026 : tests serveur ciblés sur base de test locale (données fictives) : codes / inscription / récupération 71, localisation 3, plusieurs listes 2, quantités et migrations 37, listes 93, catalogue 58 — tous réussis.
- 17/10/2026 : Android (branche `claude/evolutions-avancees`, serveur de recette jetable construit depuis la même branche, émulateur Android 16) :
  - compilation et tests unitaires réussis (runs 48 à 53) ;
  - contrôle V (pays puis ville à la création de la famille) : réussi (run 50) ;
  - contrôle M (plusieurs listes actives : désactivée par défaut, activation par l'administrateur, nouvelle liste nommée, changement de liste, désactivation refusée avec message clair, aucune liste supprimée) : réussi (run 53). Le run 52 avait révélé un message générique au refus de désactivation, corrigé.
  - Non contrôlé sur émulateur : déclenchement réel d'un rappel à l'heure choisie (dépend d'Android ; à vérifier sur téléphone), Recommander vers une liste choisie, rappel groupé sur plusieurs listes.

- 17/10/2026 : Budget, serveur : 8 tests (exemples de référence, idempotence, droits, devise figée, budgets reconduits, solde initial et corrections, suppression d'une famille) ; suite complète du serveur réussie. Ancien serveur 022 sur le schéma 025 : 54 tests réussis (retour arrière).
- 17/10/2026 : émulateur Android 16, contrôles courts : B (budget : activation, deux paiements, clôture 770,00 DH sans débit supplémentaire, vue d'ensemble) réussi au run 60 après correction d'un panneau coupé (run 58) ; W (Recommander vers une liste choisie) réussi ; Q (rappel reçu environ 30 s après l'horaire, sans montant) réussi.
- Sauvegarde : restauration de contrôle isolée prête (`verif-sauvegarde.yml`), testée localement ; **pas encore exécutée sur la sauvegarde de production** (secrets GitHub à ajouter par le propriétaire).

- 17/10/2026 : **livraison de recette** — pré-version GitHub `courses-natif-play-1.0.2-61` (commit `600e41a`, versionCode 1161, versionName 1.0.2, identifiant `app.smartcourse.courses.natif`, clé durable SHA-256 `c2cbce5e…669c88e`) : AAB `6427176c…cdaea5e0`, APK généré depuis le bundle `169eb581…77549b49`. Contrôles B et W rejoués avant construction, APK ouvert sur Android 16. Non publié sur Google Play.

- 17/10/2026 : recette 1161 sur téléphone — deux blocages expliqués. L'APK utilise la production, encore en migration 022 (`/health`, commit `f460829`) : les routes des nouvelles fonctions y répondent 404, affiché à tort « Élément introuvable » ; et la liste des devises venait uniquement du serveur (vide sur 022). Corrigé : niveau du serveur lu sur `/health`, options inactives avec « nécessite la mise à jour du serveur », devises fournies par l'application.

- 17/10/2026 : contrôle ciblé X (run 63) réussi : « Plusieurs listes actives » activée sans erreur, choix de devise ouvert et sélection (EUR), activation du budget confirmée, réglages conservés après fermeture et réouverture. Restauration de contrôle lancée : arrêtée faute des secrets GitHub (aucune donnée lue).

- 17/10/2026 : **livraison de recette 1166** — pré-version `courses-natif-play-1.0.2-66` (commit `aa1eae4`, versionCode 1166), AAB `7db67134…58957bf7`, APK `82026f28…a6b59822`. Contrôle X rejoué avant construction (une relance : serveur de test jetable non démarré au premier essai, sans rapport avec l'application). Non publié sur Google Play.

- 17/10/2026 : **restauration de contrôle de la sauvegarde de production réussie** dans un serveur PostgreSQL 18 isolé et jetable (workflow `verif-sauvegarde.yml`, run 15, sans adresse de la production) : 7 sauvegardes disponibles ; la plus récente du 17/10/2026 à 09:18 UTC (7,6 h avant le contrôle), schéma 022 ; fichier chiffré puis déchiffré avec la clé ; 32 tables restaurées, nombre de lignes de chacune identique au manifeste ; liste des migrations identique ; invariants respectés (articles achetés et achats, une liste active par famille, un administrateur actif par famille) ; 0 photo de famille référencée (aucune à vérifier).

- 17/10/2026 : **déploiement en production** — PR #1 fusionnée par le propriétaire (« Create a merge commit », commit `64af689`, second parent `54872f6`). `/health` : commit `64af689`, migration `025_budget.sql` (17:45 UTC). Sauvegarde prise par le serveur juste avant les migrations (17:44:56 UTC, manifeste en 022), restaurée dans une base isolée : réussie, 32 tables conformes ; copie protégée sous `backups-conservees/` (2 copies protégées : 09:18 et 17:44). Famille jetable « Recette jetable » : options désactivées par défaut, « Plusieurs listes actives » activée, devise proposée MAD pour le Maroc, Budget activé avec EUR choisi, réglages conservés après reconnexion, puis famille supprimée (connexion refusée ensuite). Famille du propriétaire et famille de la revue Google non touchées. Aucune publication Google Play.

## 6. Points bloquants / à valider
1. ~~Sauvegarde vérifiée avant toute migration de production~~ : faite le 17/10/2026 (voir § 5) ; à refaire juste avant le déploiement si la sauvegarde la plus récente date de plus de 24 h.
   Ancien texte : : une sauvegarde récente doit être restaurée sur une base isolée et comparée (la seule présence de variables S3 ne suffit pas). Commande prévue côté serveur : `npm run backup -- verify` : elle restaure la dernière sauvegarde dans une base de contrôle **isolée** (variable `VERIFY_DATABASE_URL`, base vide distincte de la production) et compare les comptages au manifeste. À exécuter dans l'environnement Railway (secrets non partagés). Aucune migration de production avant ce résultat.
2. **Validation visuelle des maquettes** (21 écrans, Google retiré) : https://claude.ai/artifact/B1cei82u74Zfo3upEbrs7h. Le module Budget n'est pas développé avant cette validation.

## 7. Retour arrière
- **Revenir à l'ancien code (application)** : réinstaller l'APK de référence n'est possible qu'en désinstallant (versionCode inférieur) ; préférer une nouvelle version construite depuis `reference/android-1.0.2-1144` avec un versionCode supérieur.
- **Revenir à l'ancien code (serveur)** : redéployer `reference/serveur-022` sur Railway. Les migrations sont additives : l'ancien serveur ignore les nouvelles tables et colonnes. Exception à prévoir : si l'index « une liste active » est levé, l'ancien serveur suppose une seule liste ; il faut d'abord clôturer les listes en trop (procédure documentée à l'étape multi-listes).
- **Désactiver une fonction** : décocher l'option dans Paramètres avancés (données conservées). « Plusieurs listes actives » ne se désactive que s'il ne reste qu'une liste en cours (le serveur refuse sinon : rien n'est fusionné ni supprimé automatiquement).
- **Migration 024 et ancien serveur** : l'index unique est remplacé par un déclencheur ; pour redéployer `reference/serveur-022`, désactiver d'abord l'option (une seule liste en cours), puis recréer l'index `lists_one_active_per_family` si l'on veut retrouver exactement l'ancien schéma.
- **Restaurer la base** : uniquement sur décision explicite ; une restauration perd tout ce qui a été saisi depuis la sauvegarde. Jamais automatique.
