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
| 3 | Paramètres avancés : Plusieurs listes actives, Gestion du budget (désactivées par défaut, administrateurs, synchronisées) | Maquette |
| 4 | Pays / ville de la famille, prix indicatifs seulement au Maroc, devise du budget | Maquette |
| 5 | Codes d'accès de 6 à 8 chiffres | À développer (pas de maquette nécessaire) |
| 6 | Connexion / inscription avec Google | Maquette ; configuration Google requise |
| 7 | Notifications d'activité et rappels d'achat personnels | Maquette |
| 8 | Plusieurs listes actives (option) | Maquette |
| 9 | Affichage : conserver les choix validés | Déjà livré, à conserver |
| 10 | Création de produits après vérification du catalogue complet | Déjà livré (1143-1144), à conserver |
| 11 | Cohérence liste ↔ sélection | Déjà livré (1143), à étendre aux listes multiples |
| 12-19 | Module Budget (paiements, clôture, opérations, budgets, Mon compte, écrans, exactitude) | Maquette — pas de développement avant validation |
| 20 | Permissions financières distinctes, appliquées côté serveur | Maquette |
| 21 | Exemples de référence | Serviront de tests de calcul |
| 22 | Maquettes, étapes, contrôles ciblés | En cours |
| 23 | Livraison et retour arrière | À la fin |

## 3. Écarts entre le code actuel et la spécification

| Domaine | Aujourd'hui | Attendu | Travail |
|---|---|---|---|
| Réglages | Pas de rubrique avancée, pas de réglage familial (table `families` sans options) | Rubrique « Paramètres avancés », 2 options familiales | Colonnes ou table d'options familiales (migration additive), écran, droits admin |
| Listes | Index unique « une liste active par famille » (`005`), API `/api/lists/active`, moteur Android à liste unique | Option multi-listes nommées | Lever l'index **seulement** via une règle serveur selon l'option ; nom de liste ; liste courante par profil ; API par identifiant ; l'ancienne API reste (liste par défaut) |
| Localisation | Ville par profil (`profiles.city`), Maroc seulement, pas de pays | Pays + ville **de la famille**, héritage par les membres | Colonnes `families.country`, `families.city` ; reprise prudente ; formulaires |
| Prix | Affichés selon préférence par profil, partout | Seulement au Maroc | Masquage selon le pays (application et serveur) |
| Codes | Exactement 6 chiffres (serveur et application) | 6 à 8 chiffres pour les nouveaux codes | `NEW_SECRET_PATTERN`, règle « code faible », champs, textes |
| Google | Aucun | Connexion Google réelle, liaison sécurisée | Vérification du jeton Google côté serveur, table de liaison, écrans ; identifiants Google à créer |
| Notifications | Activité seulement, réglage local par profil | + rappels personnels (jours, horaires) | Alarmes Android, réglages, état système |
| Budget | Aucun | Module complet facultatif | Tables d'opérations, budgets, compte ; droits ; écrans |
| Permissions | Rôles fixes admin / parent / personnel | + droits financiers distincts | Table de droits par profil, contrôles serveur |
| Sauvegarde | Planifiée si S3 configuré | Sauvegarde restaurable avant migration | Confirmation (§ 6) |

## 4. Décisions proposées (à valider avec les maquettes)

1. **Ordre des étapes** : (a) codes 6-8 chiffres ; (b) pays/ville et prix ; (c) paramètres avancés + rappels ; (d) plusieurs listes ; (e) budget ; (f) Google dès que la configuration Google existe. Chaque étape : migration additive, contrôle ciblé, une seule livraison finale identifiée.
2. **Familles existantes (localisation)** : pays = Maroc et ville = ville de l'administrateur principal quand elle est renseignée et reconnue ; sinon rien n'est affecté et l'administrateur est invité à compléter. Les villes déjà saisies par profil ne sont pas effacées.
3. **Solde de Mon compte** : le solde initial est l'argent disponible **au début** de la date de référence ; les opérations datées de ce jour-là sont comptées dans le solde. Les opérations antérieures restent visibles mais ne modifient pas le solde.
4. **Rappels** : alarme Android à fenêtre courte (environ ±10 min), sans permission d'alarme exacte (restreinte par Google Play) ; la liste est revérifiée au déclenchement ; hors connexion, la dernière liste connue sert.
5. **Personnel et finances** : aucun accès par défaut ; un administrateur peut lui accorder « saisir les paiements des courses », qui ne montre ni le solde, ni les entrées, ni les autres dépenses ; il peut corriger seulement ses propres saisies du jour.
6. **Devise** : proposée selon le pays (MAD pour le Maroc, EUR, USD…), confirmée à l'activation, unique par famille, non modifiable dès qu'une opération existe (sauf procédure explicite future).
7. **Montants** : enregistrés en centimes entiers ; chaque saisie porte un identifiant de requête pour éviter les doublons.

## 5. Contrôles effectués
- 17/10/2026 : production `/health` = `f460829`, migration `022`. Référence Git créée (`reference/android-1.0.2-1144`, `reference/serveur-022`). Analyse du code (listes, notifications, localisation, codes, prix, sauvegardes, rôles, authentification).

## 6. Points bloquants / à valider
1. **Sauvegarde restaurable** : confirmer que la sauvegarde automatique est active (Railway : variables `BACKUP_S3_*` ou `S3_*` renseignées, état « Sauvegarde » visible pour un administrateur). Aucune migration de production avant cette confirmation.
2. **Google** : créer dans Google Cloud (projet de l'éditeur) un écran de consentement OAuth et deux identifiants : client **Android** (paquet `app.smartcourse.courses.natif` + empreinte SHA-1 de la clé de signature, et celle de la clé Google Play si l'app est distribuée par Play) et client **Web** (son identifiant, non secret, sert au serveur pour vérifier les jetons). Sans eux, le bouton Google n'est pas inclus.
3. Validation des maquettes et des décisions du § 4.

## 7. Retour arrière
- **Revenir à l'ancien code (application)** : réinstaller l'APK de référence n'est possible qu'en désinstallant (versionCode inférieur) ; préférer une nouvelle version construite depuis `reference/android-1.0.2-1144` avec un versionCode supérieur.
- **Revenir à l'ancien code (serveur)** : redéployer `reference/serveur-022` sur Railway. Les migrations sont additives : l'ancien serveur ignore les nouvelles tables et colonnes. Exception à prévoir : si l'index « une liste active » est levé, l'ancien serveur suppose une seule liste ; il faut d'abord clôturer les listes en trop (procédure documentée à l'étape multi-listes).
- **Désactiver une fonction** : décocher l'option dans Paramètres avancés (données conservées) ; pour Google, retirer la variable de l'identifiant client (le bouton disparaît, les liaisons restent).
- **Restaurer la base** : uniquement sur décision explicite ; une restauration perd tout ce qui a été saisi depuis la sauvegarde. Jamais automatique.
