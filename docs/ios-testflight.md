# iPhone : version finale, notifications APNs et TestFlight

## Ce qui est prêt sans compte Apple

| Élément | Où |
|---|---|
| Version finale (Release) : identifiant `app.smartcourse.courses`, nom « Mes Courses », serveur fixé à la compilation, HTTPS seul, aucun accès de recette | `ios/app/project.yml`, `ios/app/Courses/Info-final.plist`, `ios/shared/build.gradle.kts` (BuildConfig généré) |
| Icône (même source que l'icône Android, 1024 px, sans transparence) | `ios/app/Courses/Assets.xcassets` |
| Manifeste de confidentialité (aucun pistage ; données du compte et des listes pour le fonctionnement) | `ios/app/Courses/PrivacyInfo.xcprivacy` |
| Droit « notifications » APNs (environnement de production) | `ios/app/Courses/Courses-final.entitlements` |
| Réception des notifications : jeton APNs envoyé au serveur, retiré à la déconnexion ; affichage même application ouverte | `NotificationsIos.kt`, `CoursesApp.swift` |
| Rappels d'achat : notifications locales aux jours et horaires choisis | `NotificationsIos.kt` |
| Envoi APNs par le serveur (HTTP/2, jeton ES256), mêmes destinataires et même texte que les autres appareils | `server/src/apns.ts` (tests : `server/test/apns.test.ts`) |
| Construction vérifiée de la version finale (arm64, non signée) | workflow « iPhone — version finale et TestFlight », tâche `archive-verifiee` |
| Signature automatique + envoi TestFlight | même workflow, tâche `testflight` (attend les accès ci-dessous) |

## Actions Apple, dans l'ordre où elles deviennent nécessaires

**Étape 1 — dès maintenant, pour pouvoir envoyer une première version TestFlight (signature + TestFlight) :**

1. **Adhérer à l'Apple Developer Program** (99 $ par an) avec l'Apple ID qui publiera l'application. Validation par Apple :
   de quelques heures à quelques jours.
2. **App Store Connect → Apps → « + » → Nouvelle app** : plateforme iOS, nom « Mes Courses », langue principale français,
   identifiant de bundle **`app.smartcourse.courses`** (à créer dans la liste proposée si besoin), SKU libre.
3. **App Store Connect → Utilisateurs et accès → Intégrations → Clés API App Store Connect** : créer une clé
   d'**accès « Admin »** (nécessaire pour que la signature automatique crée le certificat et le profil de distribution),
   télécharger le fichier `.p8` (une seule fois possible), noter l'**ID de la clé** et l'**ID de l'émetteur**.
4. **GitHub → dépôt → Settings → Secrets and variables → Actions** : ajouter 4 secrets
   (ne jamais les copier dans une conversation) :
   - `APPLE_TEAM_ID` : identifiant d'équipe (Apple Developer → Membership, 10 caractères) ;
   - `ASC_KEY_ID`, `ASC_ISSUER_ID` : ceux de la clé API ;
   - `ASC_KEY_P8` : le contenu complet du fichier `.p8`.
5. Me prévenir : je lance le workflow avec « Signer et envoyer sur TestFlight » ; la version apparaît dans App Store Connect →
   TestFlight après le traitement d'Apple (≈ 10 à 30 min). Pour l'installer sur votre iPhone : TestFlight → Testeurs internes →
   vous ajouter, puis l'app **TestFlight** sur l'iPhone.

**Étape 2 — pour les notifications de demandes (APNs), au moment de les essayer sur l'iPhone :**

6. **Apple Developer → Certificates, Identifiers & Profiles → Keys → « + »** : cocher **Apple Push Notifications service (APNs)**,
   télécharger le fichier `.p8`, noter l'**ID de la clé**. (La capacité « Push Notifications » de l'identifiant
   `app.smartcourse.courses` est activée automatiquement par la signature, grâce au fichier d'entitlements.)
7. **Railway → service de recette** d'abord, puis production après votre accord : variables
   `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` = `app.smartcourse.courses`, `APNS_KEY_P8` = contenu du `.p8`.
   Sans elles, l'iPhone s'enregistre mais le serveur n'envoie rien (message dans ses journaux).

**Étape 3 — publication App Store (plus tard) :** fiche App Store (textes, captures 6,9" et 6,5"), confidentialité de l'app
(à remplir dans App Store Connect, conforme au manifeste), compte de démonstration pour la revue Apple.

## Serveur

- La version TestFlight utilise par défaut le **serveur de production** (même service que l'application Android).
  Le choix « recette » du workflow permet une version TestFlight reliée à la recette Railway.
- L'envoi APNs n'est **pas encore en production** : il ne sera déployé qu'avec votre accord (aucune migration : les iPhones
  sont enregistrés dans la table existante des appareils). Sans lui, la version TestFlight fonctionne entièrement, sauf les
  notifications de demandes ; les rappels d'achat (locaux) fonctionnent.

## Différences assumées avec Android

- **Demandes** : Android vérifie le serveur environ toutes les 15 minutes ; l'iPhone reçoit une notification APNs envoyée par le
  serveur (en général en quelques secondes). Mêmes destinataires (parents et administrateurs, jamais l'auteur ni le personnel),
  même texte.
- **Rappels d'achat** : l'iPhone ne laisse pas une application vérifier la liste à l'heure du rappel ; le nombre d'articles est
  celui de la liste quand l'application a été quittée (reprogrammé à chaque sortie), aucun rappel s'il ne restait rien.
