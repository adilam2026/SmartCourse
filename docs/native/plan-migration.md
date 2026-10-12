# Plan de migration progressif vers l'application native

Principe : ne pas réécrire le serveur ; ne rien remplacer avant validation ; chaque étape livrable séparément, sur la branche `claude/android-native`, avec un identifiant de recette distinct. L'application actuelle (PWA + TWA) reste servie et installée pendant tout le développement.

| Étape | Contenu | Réutilisé tel quel | À construire côté Android | Critère de sortie |
|---|---|---|---|---|
| 0 | Prototype visuel (cette livraison) | Photos du catalogue | Thème, composants, 12 écrans à données fictives | Validation visuelle de l'utilisateur |
| 1 | Authentification | `POST /api/login`, sessions, rôles, isolation des familles, récupération | Écran V01 branché, stockage du jeton dans `EncryptedSharedPreferences`/Keystore, profil actif, déconnexion | Connexion des 3 rôles sur un environnement de recette ; jamais de code en clair dans les journaux |
| 2 | Lecture des API | `/api/catalog`, `/api/lists/active`, `/api/history`, `/api/stats`, prix | Client HTTP (OkHttp + kotlinx.serialization), modèles, arithmétique décimale exacte identique à `pricing.ts` | Écrans V02, V03, V06, V09, V10, V12 affichent les données d'une famille d'essai |
| 3 | Données locales | — | Base **Room** : catalogue, liste, brouillons par famille + profil, file d'envoi (outbox), journal d'idempotence | Tests : isolation famille/profil, aucune fuite au changement de compte |
| 4 | Écritures et synchronisation | `ops` idempotents, `op_log`, route `/api/lists/active/ops`, SSE | Moteur de synchro (WorkManager + flux SSE), « Envoi en attente », reprise après coupure, liste clôturée/supprimée → « Reprendre », jamais d'ajout à une archive | Les scénarios hors connexion de l'application actuelle rejoués côté Android |
| 5 | Sélection et quantités | Règles d'unités du serveur | V04/V05 branchés au brouillon Room ; conversions kg↔g, L↔ml ; droits du personnel inchangés | Parité fonctionnelle avec la V3 web |
| 6 | Administration | Routes admin, permissions | V07–V11 branchés (profils, catalogue, prix, affichage), protections administrateur principal/dernier administrateur | Tests de droits identiques à `server/test` |
| 7 | Notifications | Web Push → **FCM** | Canal de notification, `POST_NOTIFICATIONS`, enregistrement du jeton (nouvelle route serveur minimale) | À décider : FCM exige un projet Firebase (hors Railway) ; alternative : notifications sur flux SSE au premier plan seulement |
| 8 | Migration des utilisateurs | Aucune donnée à migrer : même serveur, mêmes comptes | Même code famille/identifiant/code ; installation en parallèle puis bascule volontaire | Période de cohabitation ; retrait de l'ancienne application seulement sur décision explicite |

## Points à décider avec vous
1. Notifications : FCM (nécessite un service Google hors Railway) ou notifications limitées au premier plan.
2. Distribution : lien APK de recette, puis, plus tard seulement, canal de test fermé — **aucune publication Google Play** sans votre accord explicite.
3. Signature : clé définitive à créer par vous (jamais transmise) avant tout APK installable durablement ; l'APK du prototype est signé par une clé jetable.
4. Serveur : aucune modification prévue à l'étape 1–4 ; seule une route d'enregistrement de jeton serait ajoutée à l'étape 7.

Rien dans ce plan ne touche la production ni les données réelles avant votre autorisation.
