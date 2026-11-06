# Mise à jour de l'application — proposée ou obligatoire (Android et iPhone)

Réglée par un gestionnaire sur `/gestion/mise-a-jour`, **sans nouvelle publication**. Rien n'est activé par défaut, ni par une
publication ou un envoi au store. **Production : rien d'activé** (ce travail n'y est pas déployé).

## Ce qui existait avant (constat)

| | Lien de mise à jour | Proposition facultative | Blocage des anciennes versions |
|---|---|---|---|
| **Serveur** (avant migration 033) | fiche Google Play | Android : version « conseillée » | Android : version minimale, avec confirmation de disponibilité ; annulation immédiate |
| **Android natif ≥ 1189** (`AppUpdate.kt`) | oui (Google Play, sinon navigateur) | oui, « Plus tard » (24 h) | oui, écran bloquant ; une panne réseau ne bloque jamais |
| **Android natif ≤ 1188** | non | non | **non — impossible à imposer** (le code n'existe pas dans ces versions) |
| **Application web « SmartCourse » (TWA)** | sans objet : se met à jour avec le serveur | | |
| **iPhone** | non | non | non |

Il n'existait ni réglage iPhone, ni interrupteur séparé (désactiver effaçait la version minimale), ni prise en compte des
appareils incapables d'installer la version exigée, ni confirmation du déploiement progressif.

## Ce qui est en place maintenant

- **Réglages séparés** Android et iPhone : dernière version disponible (proposition facultative) et version minimale autorisée
  (blocage), comparées sur les **numéros techniques** : `versionCode` Android, numéro de build `CFBundleVersion` iPhone — jamais
  « 1.0.2 ». La comparaison est numérique (9 < 10).
- **Interrupteur du blocage** séparé de la version minimale : on peut préparer un blocage sans l'activer, le couper en un geste et
  le réactiver plus tard.
- **Logique et écrans communs** Android / iPhone (`AppUpdate.kt`). Seules l'ouverture de la fiche et la lecture du système diffèrent
  (`AppUpdateAndroid.kt`, `AppUpdateIos.kt`).
  - En dessous du minimum, avec le blocage actif : écran « Mise à jour nécessaire », bouton « Mettre à jour » vers la fiche
    officielle (Google Play, App Store), pas de « Plus tard ». Le bouton Retour d'Android ne le contourne pas.
  - Au-dessus du minimum mais sous la dernière version : « Une nouvelle version de Mes Courses est disponible » avec « Plus tard ».

### Garde-fous

1. **Jamais automatique.** Activer (ou durcir) un blocage exige deux confirmations du gestionnaire :
   - la version est réellement téléchargeable sur le store par toutes les personnes concernées ;
   - le déploiement progressif est terminé (100 %) et les appareils concernés peuvent l'installer.

   L'iPhone exige en plus l'adresse de la fiche App Store : sans fiche, rien n'est proposé ni imposé.
2. **Appareils incompatibles.** Le « système minimal » de la version exigée (niveau d'API Android, version d'iOS) est facultatif. Un
   appareil plus ancien n'est **jamais bloqué**. Un système non transmis (versions Android déjà installées) n'est pas bloqué non
   plus quand ce minimum est renseigné.
3. **Panne réseau ou du service.** L'application ne bloque que sur une réponse explicite du serveur. Une vérification impossible
   ne bloque jamais, y compris au démarrage.
4. **Données conservées.** L'écran se pose au-dessus de l'application sans rien effacer. Les modifications en attente continuent
   de partir (vérifié sur iPhone : un article ajouté hors connexion arrive au serveur pendant le blocage).
5. **Désactivation immédiate.** Deux moyens :
   - bouton « Désactiver le blocage maintenant » sur `/gestion/mise-a-jour` ;
   - sans la page : `admin-cli update-disable [android|ios]`.

   Les numéros sont gardés pour une réactivation. L'effet est immédiat : un téléphone bloqué revérifie à chaque retour au premier
   plan.
6. **Journal.** Chaque changement est inscrit dans l'historique, avec qui, quand et une note.

## Versions Android ≤ 1188 : transition

Ces versions n'ont aucun mécanisme de mise à jour : **on ne peut pas les forcer rétroactivement**. Pour la monétisation, le quota
est appliqué **par le serveur** : une ancienne version ne peut donc pas le contourner. Au-delà de dix listes, elle reçoit un refus
compréhensible et ne perd rien (articles gardés). Elle ne peut pas acheter : l'administrateur doit mettre à jour depuis Google Play
pour débloquer la famille.

## Monétisation : blocage préparé, non activé

À faire **seulement** après trois conditions :
1. paiement validé en conditions réelles (lot 5) ;
2. nouvelle version réellement téléchargeable à 100 % sur les deux stores ;
3. votre accord.

Ensuite, sur `/gestion/mise-a-jour`, pour chaque plateforme : version minimale = première version contenant les achats, blocage
activé, avec les deux confirmations. En cas de problème, désactivation immédiate (garde-fou 5).

## Contrôles

- **Serveur** (`server/test/app-update.test.ts`) :
  - comparaison numérique ;
  - blocage préparé mais désactivé ;
  - les deux confirmations exigées ;
  - fiche App Store obligatoire ;
  - appareil trop ancien ou système inconnu ;
  - indépendance Android / iPhone ;
  - désactivation immédiate puis réactivation (nouvelles confirmations).
- **iPhone, sur la recette Railway** (`test7_MiseAJourObligatoire`, workflow « iPhone — hors connexion… », mot-clé
  `[controles:maj]`) :
  - à jour ;
  - proposition et « Plus tard » ;
  - blocage activé mais hors connexion : pas de blocage, modification en attente ;
  - réseau revenu : blocage, et la modification arrive au serveur ;
  - relance ;
  - appareil trop ancien ;
  - désactivation ;
  - version égale au minimum.

  Le réglage iPhone de la recette est remis à zéro à la fin, même en cas d'échec. Pour ce contrôle, la session de recette
  est ouverte par l'API et transmise au lancement (crochet absent de la version finale). La connexion par l'écran est
  contrôlée ailleurs, mais le clavier du simulateur n'y apparaît pas toujours.
- **Android, sur une recette jetable locale à la CI, même code serveur** (section Z de `scripts/native-e2e-final.sh`, groupe
  `[android-e2e:Z]`) :
  - aucune mise à jour, puis proposition et « Plus tard » ;
  - refus sans confirmations, puis blocage et ouverture de Google Play ;
  - Retour qui ne contourne pas le blocage ;
  - panne réseau, puis retour du réseau ;
  - appareil trop ancien ;
  - désactivation ;
  - version égale au minimum, et données conservées.

Retour arrière du schéma : `server/rollback/033_app_update_platforms.down.sql`.
