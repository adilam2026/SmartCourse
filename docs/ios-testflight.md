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
| Signature (certificat et profil fournis) + envoi TestFlight | même workflow, tâche `testflight` (attend les accès ci-dessous) |

## Actions Apple

Guide détaillé, dans l'ordre : **`docs/ios-apple-etapes.md`** (inscription, identifiant et application, certificat et profil de
distribution, clé API au rôle **Developer** — pas Admin —, secrets GitHub, premier envoi TestFlight, clé APNs et test réel).

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
