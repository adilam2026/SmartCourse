# Monétisation — proposition d'intégration (avant développement)

Dix créations de listes gratuites par famille, puis abonnement annuel (référence 7 USD) ou achat à vie (référence 15 USD), mêmes
fonctionnalités pour toute la famille, sur Android (Google Play Billing) et iPhone (StoreKit). Rien n'est activé en production ni
soumis aux stores sans accord.

## 1. Ce que montre l'architecture actuelle

| Constat | Conséquence |
|---|---|
| Toutes les créations de listes passent par **deux fonctions serveur** : `createList` (`POST /api/lists`, « Créer une liste ») et `ensureActiveList` (création implicite quand une demande d'articles arrive sans liste en cours — personnel, demandes hors connexion envoyées au retour du réseau). | Un seul point de contrôle, côté serveur, couvre Android, iPhone, anciennes versions et hors connexion. |
| Les modèles et « Recommander » ne créent pas de liste côté serveur : l'application crée (ou rouvre) la liste par ces mêmes routes puis y ajoute des articles. Il n'existe ni « dupliquer » ni « rouvrir » côté serveur. | Dupliquer / créer depuis un modèle compte automatiquement comme une création ; consulter, renommer, partager, modifier ne passent jamais par ces fonctions. |
| Les demandes d'articles portent déjà un identifiant de lot (`batch.id`) qui empêche leur double application. | Il sert aussi de clé d'idempotence pour la création implicite. |
| `POST /api/lists` n'a pas d'identifiant de requête ; avec « plusieurs listes », une requête rejouée (réponse perdue) créerait une deuxième liste. | Ajout d'un `requestId` facultatif (nouvelles versions) ; sans lui, comportement actuel. |
| Une liste unique en cours est garantie par un index / déclencheur ; deux appareils qui créent en même temps : l'un réussit, l'autre reçoit la liste existante (implicite) ou 409 (explicite). | Le compteur est incrémenté dans la même transaction que l'insertion, sous verrou de la famille : jamais deux fois, jamais de création sans comptage. |
| Anciennes versions Android : un refus 403/409/400 d'un lot de demandes **supprime** le lot (« Une demande a été refusée… ») ; un **404** le **conserve** (« vos articles sont gardés, Reprendre »). | Une création implicite bloquée répond **404 `quota_reached`** : aucune demande perdue sur les anciennes versions ; les nouvelles versions affichent l'écran de paiement ou « contactez un administrateur ». |
| Politique de mise à jour existante (`app_update_policy` : conseillée / obligatoire par `versionCode`). | L'activation peut être précédée d'une mise à jour conseillée puis obligatoire. |

## 2. Modèle serveur (migration 031, réversible)

```
families
  + list_quota_since   timestamptz NULL   -- NULL = règle non activée pour cette famille (comportement actuel, illimité)
  + list_creations_used int NOT NULL DEFAULT 0

list_creations (id, family_id, list_id UNIQUE, created_by, request_key, created_at)
  UNIQUE (family_id, request_key) WHERE request_key IS NOT NULL   -- requête rejouée = même création

family_entitlements (id, family_id, platform 'google'|'apple', product_id, kind 'annual'|'lifetime',
  purchase_key UNIQUE (platform, purchase_key),   -- même achat jamais rattaché à deux familles
  buyer_profile_id, status 'active'|'grace'|'on_hold'|'cancelled'|'expired'|'refunded'|'revoked',
  expires_at, auto_renewing, verified_at, environment 'sandbox'|'production', created_at, updated_at)

entitlement_events (id, entitlement_id, source 'client'|'google_rtdn'|'apple_notification'|'reconcile', type, payload_hash, received_at)
  -- traçabilité (acheteur, renouvellements, remboursements), sans données de paiement

app_config.list_quota_enabled  boolean DEFAULT false             -- interrupteur global (recette : oui ; production : non)
```

- **Règle** (une seule fonction `checkAndCountCreation`, dans la transaction de création, `SELECT … FROM families … FOR UPDATE`) :
  si l'interrupteur est actif, que `list_quota_since` est renseigné, qu'aucun droit n'est actif et que `list_creations_used ≥ 10` →
  refus, **aucune liste créée**. Sinon : insertion de la liste, d'une ligne `list_creations`, `list_creations_used + 1`.
  Le compteur augmente **à chaque création**, même pendant un abonnement (compteur permanent) : à l'expiration, aucun nouveau lot.
- **Idempotence** : création implicite → clé = `batch.id` ; `POST /api/lists` → clé = `requestId`. Une clé déjà vue renvoie la liste
  déjà créée, sans compter.
- **Droit actif** = un `family_entitlements` avec `kind = 'lifetime'` et statut `active`, ou `kind = 'annual'` et `expires_at > now()`
  (annulé = accès conservé jusqu'à `expires_at` ; remboursé / révoqué = droit retiré immédiatement).
- **Réponses de refus** : création implicite → **404 `quota_reached`** (anciennes versions : articles gardés) ; `POST /api/lists` →
  **409 `quota_reached`** avec un message clair. Nouvelles versions : écran dédié.
- **Lecture** : `GET /api/family/plan` → `{ quotaActive, freeRemaining, used, entitlement: { kind, status, expiresAt, platform } | null, canPurchase }`
  (`canPurchase` = administrateur). Affichage discret « 3 listes gratuites restantes ».

## 3. Familles existantes

- La migration ne compte **rien** rétroactivement et n'active **rien**.
- **Activation explicite** (commande d'administration, journalisée) : `list_quota_since = now()` et compteur à 0 pour chaque famille
  sans valeur → dix nouvelles créations gratuites pour toutes, données et personnalisations intactes. Les familles créées ensuite
  reçoivent `list_quota_since` à leur création.
- **Retour arrière** : interrupteur global à `false` → plus aucun blocage, compteurs et achats conservés. Réactivation = mêmes
  compteurs (pas de nouveau lot). Annulation complète : migration inverse (suppression des colonnes et tables ajoutées).

## 4. Achats et vérification serveur

| | Android (Google Play Billing) | iPhone (StoreKit 2) |
|---|---|---|
| Produits | `courses_famille_annuel` (abonnement, base plan annuel renouvelable), `courses_famille_a_vie` (achat unique non consommable) | mêmes identifiants : abonnement auto-renouvelable (groupe « Mes Courses Famille ») et non consommable |
| Prix affichés | `ProductDetails` (prix et devise du store) | `Product.displayPrice` |
| Rattachement à la famille | `obfuscatedAccountId` = jeton store de la famille (`storeAccountToken`, UUID aléatoire, migration 032) | `appAccountToken` = le même jeton |
| Vérification | serveur → Google Play Developer API (`purchases.subscriptionsv2.get`, `purchases.products.get`), puis **accusé de réception** par le serveur (sinon remboursement automatique à 3 jours) | serveur → vérification de la signature JWS de la transaction (chaîne jusqu'à « Apple Root CA - G3 », empreinte épinglée) et, si la clé est fournie, App Store Server API (`/inApps/v1/subscriptions`, `/inApps/v1/transactions`) |
| Événements | Real-time developer notifications (Pub/Sub, envoi push) → `POST /api/store/google/rtdn?token=<GOOGLE_RTDN_TOKEN>` ; le contenu sert seulement à savoir quel achat **revérifier** auprès de Google | App Store Server Notifications V2 (JWS vérifié) → `POST /api/store/apple/notifications` (URL sandbox = recette) |
| Présenter / restaurer | `POST /api/family/purchases {platform:"google", productId, purchaseToken}` (achat, puis `queryPurchasesAsync` pour restaurer) | `POST /api/family/purchases {platform:"apple", signedTransaction}` (`jwsRepresentation` ; `Transaction.currentEntitlements` pour restaurer) |
| Gérer l'abonnement | lien profond Play « Abonnements » | `showManageSubscriptions` (écran Apple) |

- **Partage Android ↔ iPhone** : le droit appartient à la famille sur le serveur ; un membre sur l'autre plateforme est débloqué
  sans achat (aucun « restaurer » nécessaire).
- **Même achat, deux familles** : clé unique `(platform, purchase_key)` (jeton Google lié / `originalTransactionId` Apple) + contrôle
  du rattachement (`obfuscatedAccountId` / `appAccountToken`) → refus explicite.
- **Doubles achats** : famille déjà couverte → écran « Déjà actif » sans bouton d'achat. Abonné qui passe à vie : achat à vie
  possible, puis message « Votre abonnement continue d'être facturé : arrêtez-le dans Google Play › Abonnements (ou Réglages ›
  identifiant Apple › Abonnements sur iPhone) » avec le lien de gestion — aucune annulation automatique promise.
- **Pas de Stripe, aucun lien de paiement externe.**

## 5. Écrans (communs Android / iPhone, même design)

- Écran « Liste » : ligne discrète « 3 listes gratuites restantes » (quota actif, sans droit).
- Onzième création : **administrateur** → écran de paiement (deux offres, prix du store, durée, renouvellement automatique annuel,
  achat unique, « Restaurer les achats », conditions) ; **autres membres** → « Limite de listes gratuites atteinte : demandez à un
  administrateur de la famille de débloquer Mes Courses ». La liste en cours, l'historique, les statistiques et toutes les données
  restent accessibles.
- Compte › « Mes Courses Famille » : état du droit (offre, renouvellement, échéance), Restaurer, Gérer l'abonnement.

## 6. Anciennes versions — constat vérifié et transition

| Application installée | Mécanisme de mise à jour imposable ? | À la limite (sans mise à jour) |
|---|---|---|
| **« SmartCourse » actuelle** (Trusted Web Activity, écrans servis par le serveur) | Pas besoin : ses écrans se mettent à jour d'eux-mêmes au déploiement du serveur (`/version.json`, rechargement automatique). | Elle recevra le message « listes gratuites utilisées » ; **aucun achat possible** depuis cette application (pas de Google Play Billing dans une page web, et aucun lien de paiement externe) : elle invite à passer par l'application Mes Courses. |
| **Mes Courses native**, versions construites **à partir du 24/10/2026** (versionCode ≥ 1189 ; premiers bundles signés : 1192 et 1196, `AppUpdate.kt`) — la 1188 du 20/10 ne l'a pas | **Oui** : `app_update_policy` (conseillée / obligatoire) est lue par ces versions. | Refus serveur compréhensible, données gardées. |
| **Mes Courses native**, versions **antérieures** au 24/10/2026 | **Non** : elles n'interrogent pas `/api/app/update` ; une mise à jour obligatoire ne peut **pas** leur être imposée rétroactivement. | « Créer une liste » : 409 → « Action impossible dans l'état actuel. Actualisez l'écran. » (message générique de ces versions) ; demande du personnel sans liste : **404** → articles **gardés** (« La liste n'existe plus : vos articles sont gardés, appuyez sur « Reprendre » »). Aucune donnée perdue, mais message imprécis. |

Transition (décidée : conseillée puis obligatoire, sans rien activer en production pour l'instant) :
1. publier la version avec paiement ;
2. mise à jour conseillée, puis obligatoire (`min_code`) — effective seulement pour les versions ≥ 1189 ;
3. versions antérieures : refus serveur sans perte (ci-dessus) ; message de remplacement possible uniquement par une mise à jour
   installée par l'utilisateur ; prévenir les familles concernées (e-mail de récupération) avant l'activation ;
4. activer la règle (`quota-activate --execute`), jamais avant votre accord.

Décisions validées : compteur permanent (chaque création compte, même sous un droit payant ; aucun nouveau lot à l'expiration),
mise à jour conseillée puis obligatoire, lot serveur d'abord sur la recette.

## 7. Validation (recette uniquement, environnements de test des stores)

- Serveur (tests automatiques) : seuils 9/10/11, création explicite et implicite, créations simultanées (deux connexions en parallèle),
  requêtes rejouées (`batch.id`, `requestId`), hors connexion (lot envoyé après épuisement → articles gardés), suppression/archivage
  sans crédit, renommer/consulter/partager sans comptage, droit actif/annulé/expiré/remboursé/révoqué, même achat refusé pour une
  deuxième famille, notifications rejouées (idempotentes), activation/désactivation.
- Android : comptes testeurs de licence (achats de test, abonnement accéléré : renouvellement en minutes) via une **piste de test
  interne** (version non publique ; nécessite votre accord pour l'envoi).
- iPhone : bac à sable Apple via TestFlight (renouvellements accélérés), plus fichier de configuration StoreKit pour les contrôles
  automatiques sur simulateur.
- Partage : achat sur Android → déblocage vérifié sur iPhone, et inversement ; restauration sur chaque plateforme.

## 8. Configuration des stores (au moment utile)

**Play Console** (propriétaire ou administrateur) :
1. *Monétiser › Produits › Abonnements* : `courses_famille_annuel`, base plan annuel renouvelable, prix 7 USD (conversion locale
   proposée par Google, ajustable).
2. *Produits intégrés* : `courses_famille_a_vie`, 15 USD.
3. *Paramètres › Testeurs de licence* : ajouter les comptes Gmail de test.
4. *Monétiser › Configuration de la monétisation* : notifications en temps réel → sujet Google Cloud Pub/Sub (projet Google Cloud lié),
   avec un abonnement Pub/Sub de type **push** vers `https://<serveur>/api/store/google/rtdn?token=<GOOGLE_RTDN_TOKEN>`
   (jeton aléatoire long, choisi par vous, saisi seulement dans Pub/Sub et dans les variables du serveur).
5. *Utilisateurs et autorisations* : compte de service Google Cloud (API Google Play Android Developer) avec seulement
   « Afficher les données financières » et « Gérer les commandes et les abonnements », limité à l'application ; clé JSON →
   variable `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` du serveur de recette, avec `GOOGLE_PLAY_PACKAGE` (nom du paquet Android).
6. *Tests › Test interne* : envoi de la version de test (après votre accord).

**App Store Connect** (Account Holder ou Admin pour les contrats ; App Manager pour les produits) :
1. *Accords, taxes et services bancaires* : contrat « Paid Apps » (obligatoire pour tout achat intégré, même en test).
2. *Abonnements* : groupe « Mes Courses Famille », abonnement `courses_famille_annuel` (1 an, palier de prix ≈ 7 USD).
3. *Achats intégrés* : `courses_famille_a_vie`, non consommable (palier ≈ 15 USD) ; *Partage familial* désactivé (la famille est gérée
   par l'application).
4. *Informations sur l'app › Notifications du serveur App Store* : URL **sandbox** = `https://<recette>/api/store/apple/notifications`,
   version 2 (l'URL de production seulement au lancement, après votre accord).
5. *Utilisateurs et accès › Intégrations › Achats intégrés* : clé « In-App Purchase » (.p8) → variables `APPLE_IAP_KEY_ID`,
   `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_P8` du serveur de recette, avec `APPLE_BUNDLE_ID` (seule obligatoire pour vérifier les
   transactions ; la clé ajoute l'état à jour des abonnements et le rapprochement).
6. *Utilisateurs et accès › Sandbox* : comptes testeurs.

### Variables du serveur (aucune valeur dans le dépôt ni dans les journaux)

| Variable | Rôle |
|---|---|
| `GOOGLE_PLAY_PACKAGE`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | vérification Google (sans elles : achats Android refusés poliment, 503) |
| `GOOGLE_RTDN_TOKEN` | protège l'adresse des notifications Google (sans lui : adresse fermée, 404) |
| `APPLE_BUNDLE_ID` | vérification des transactions Apple (sans lui : achats iPhone refusés poliment, notifications 404) |
| `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_P8` | facultatives : API App Store Server (état à jour, rapprochement) |
| `STORE_ACCEPT_SANDBOX=1` | achats de test admis (posée automatiquement sur la recette ; **jamais** en production) |
| `STORE_SANDBOX_FAMILIES` | production : familles (UUID) dont les achats de test sont admis — la famille de vérification Apple / Google |

## 9. Lots de travail proposés

1. Serveur : migration 031, compteur, idempotence, refus compatibles anciennes versions, `GET /api/family/plan`, activation et
   retour arrière, tests 9/10/11, concurrence, rejeu, hors connexion. (Aucun compte store nécessaire.)
2. Écrans communs : compteur discret, écran de paiement (administrateur) / message (autres), état du droit.
3. Vérification Google + iPhone côté serveur (avec simulateurs de réponses des stores dans les tests), notifications, rapprochement
   périodique. **Fait** (migration 032) : `POST /api/family/purchases`, notifications Google et Apple, rapprochement toutes les
   12 h et `admin-cli store-status | store-reconcile`, événement `plan.updated`. Règles vérifiées par 18 tests : jeton de famille
   obligatoire, jamais deux familles, présentations simultanées et rejouées, paiement en attente, arrêt du renouvellement (accès
   jusqu'à l'échéance), expiration sans nouveau lot gratuit, période de grâce, suspension, remboursement et révocation définitifs
   (sauf annulation du remboursement par Apple), abonnement Google repris (ancien jeton remplacé), achat Partage familial Apple
   refusé, achat de test refusé hors recette, notification d'un achat jamais présenté, signature / racine / application Apple
   invalides refusées. Retour arrière : `server/rollback/032_store_purchases.down.sql`.
4. Android Play Billing, iPhone StoreKit 2, restaurer, gérer l'abonnement.
5. Essais réels sur la recette avec les comptes de test des stores, partage Android ↔ iPhone.
