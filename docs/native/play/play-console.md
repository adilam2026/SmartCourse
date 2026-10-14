# Mes Courses — informations pour la Play Console

Préparé à partir du comportement réel de l'application (code de `android-native/`, manifeste fusionné du bundle, serveur).
**Rien n'a été soumis.** Aucun identifiant de compte personnel ne figure dans ce document.

## 0. Fiche distincte, identifiant et signature

- Identifiant : **`app.smartcourse.courses.natif`**. Il diffère de l'ancienne application (`app.smartcourse.courses`) :
  Google Play exige une **nouvelle fiche** (« Créer une application »). L'ancienne fiche ne peut pas recevoir ce bundle et ne
  doit pas être modifiée pour lui. L'identifiant n'est pas modifié.
- Le bundle est signé par la **clé durable** (`courses-natif`, SHA-256
  `C2:CB:CE:5E:2F:61:8A:21:7A:C6:7A:15:A7:2C:E2:0F:BB:B3:B9:80:BC:3B:AF:43:DD:8A:4A:EA:E6:69:C8:8E`).
- **Décision à prendre à la création de la fiche — « Signature d'application Play »** (obligatoire pour un bundle) :
  - **Option A (choix par défaut de Google)** : Google crée et garde la clé de signature de l'application ; la clé durable
    devient la **clé d'importation**. Simple, aucune clé à exporter. Conséquence : l'application installée depuis Google Play
    aura une **signature différente** de l'APK installé depuis GitHub ; un téléphone qui a l'APK GitHub devra le
    **désinstaller une fois** avant d'installer la version Play (les données de la famille restent sur le serveur ; seuls les
    envois encore en attente sur ce téléphone seraient perdus).
  - **Option B** : « Utiliser une clé existante » : la clé durable est envoyée chiffrée à Google (outil PEPK). Même signature
    partout : la version Play met à jour l'APK GitHub sans désinstallation. Demande d'exporter la clé privée chiffrée pour
    Google (opération à préparer séparément, jamais dans un fichier public).
  - Ni l'une ni l'autre n'est choisie à votre place.

## 1. Sécurité des données (formulaire « Data safety »)

Réponses générales :

| Question | Réponse |
|---|---|
| L'application collecte-t-elle ou partage-t-elle des données utilisateur des types requis ? | **Oui** |
| Toutes les données collectées sont-elles chiffrées en transit ? | **Oui** (HTTPS uniquement vers le serveur permanent) |
| Proposez-vous un moyen de demander la suppression des données ? | **Oui** — dans l'application : *Compte → Supprimer mon compte* (tous les rôles ; l'administrateur principal transfère d'abord son rôle ou supprime toute la famille) ; sur le web : `/suppression-compte` |
| Données partagées avec des tiers | **Aucune** (Railway — hébergement — et Brevo — envoi d'e-mails — sont des prestataires agissant pour notre compte : ce n'est pas un « partage » au sens de Google Play) |

Aucune bibliothèque de publicité, de mesure d'audience ou de rapport de plantage n'est incluse (vérifié dans les dépendances :
Compose, OkHttp, kotlinx-serialization, Coil, WorkManager, AndroidX Security). Aucun identifiant publicitaire n'est lu.

Types de données **collectés** (envoyés au serveur de l'application) :

| Catégorie Google Play → type | Données concrètes | Obligatoire ? | Finalités à cocher |
|---|---|---|---|
| Informations personnelles → **Nom** | prénom ou nom affiché de chaque profil, nom de la famille | Oui | Fonctionnalité de l'application ; Gestion du compte |
| Informations personnelles → **Adresse e-mail** | adresse de récupération de l'administrateur principal | Oui (création de la famille) | Gestion du compte ; Fonctionnalité de l'application (code de vérification, récupération) |
| Informations personnelles → **ID utilisateur** | identifiant de connexion, code famille | Oui | Gestion du compte ; Fonctionnalité de l'application |
| Position → **Position approximative** | ville choisie dans la liste (pas de GPS), pour le catalogue et les prix indicatifs | Oui | Fonctionnalité de l'application |
| Informations financières → **Historique des achats** | articles achetés, quantités, prix indicatifs, auteur et heure de l'achat | Oui | Fonctionnalité de l'application |
| Activité dans l'application → **Autre contenu généré par l'utilisateur** | listes, demandes, quantités, favoris, préférences d'affichage | Oui | Fonctionnalité de l'application |

Pour chaque type : **collecté = oui**, **partagé = non**, **traité de façon éphémère = non**.

Non collectés : position précise, contacts, photos et vidéos (l'application Android n'envoie aucune photo ; elle affiche
celles du catalogue), fichiers, agenda, santé, messages, audio, identifiants d'appareil ou publicitaires, rapports de
plantage, diagnostics. Le code d'accès n'est jamais conservé en clair (empreinte seulement) ; Google ne demande pas de le
déclarer comme type distinct, mais il relève de la gestion du compte.

### Suppression et conservation (réponses « Suppression des données » et texte d'aide)

- **Suppression d'un compte** (dans l'application ou sur `/suppression-compte`) : nom, identifiant, code d'accès, ville,
  réglages, adresse e-mail éventuelle, liens et journal des e-mails, demande de création et abonnements aux notifications
  sont effacés immédiatement ; sessions fermées, reconnexion refusée. Les listes et achats, qui appartiennent à la famille,
  restent sous « Ancien profil ».
- **Suppression de la famille** (administrateur principal) : toutes les données de la famille sont effacées immédiatement.
- **Conservation** : demandes de création de famille 30 jours au plus ; sauvegardes chiffrées 3 mois au plus (7 quotidiennes,
  4 hebdomadaires, 3 mensuelles) ; journaux techniques de l'hébergeur : durée limitée fixée par Railway (non vérifiée).
- Données conservées après suppression : aucune donnée personnelle ; seuls subsistent le libellé « Ancien profil » dans
  l'historique de la famille (suppression d'un compte) ou une trace anonyme (suppression d'une famille).

Remarque : le serveur conserve temporairement l'adresse IP des requêtes pour la sécurité (limitation des abus) ; c'est une
donnée de journal technique, non un type à déclarer dans ce formulaire.

## 2. Permissions et justification

Permissions du manifeste fusionné du bundle (relevées par bundletool, voir `bundle-permissions.txt`) :

| Permission | Origine | Justification |
|---|---|---|
| `android.permission.INTERNET` | application | Joindre le serveur de la famille (HTTPS). |
| `android.permission.ACCESS_NETWORK_STATE` | application, WorkManager | Savoir si le réseau est revenu pour envoyer les changements gardés hors connexion. |
| `android.permission.POST_NOTIFICATIONS` | application | Notifications facultatives des nouvelles demandes (parents et administrateurs) ; demandée seulement si l'utilisateur les active. |
| `android.permission.WAKE_LOCK` | WorkManager | Laisser finir la vérification périodique en arrière-plan. |
| `android.permission.RECEIVE_BOOT_COMPLETED` | WorkManager | Reprogrammer la vérification périodique après un redémarrage du téléphone. |
| `android.permission.FOREGROUND_SERVICE` | WorkManager | Déclarée par la bibliothèque ; l'application ne lance aucun service au premier plan. |
| `app.smartcourse.courses.natif.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX | Permission interne à l'application (protection de ses récepteurs). |

Aucune permission sensible (position, contacts, appareil photo, micro, stockage, SMS, journaux d'appels). Aucune déclaration
de permission spéciale n'est donc demandée par la Play Console.

## 3. Classification du contenu (questionnaire IARC)

- Catégorie : **Toutes les autres catégories d'applications** (ni jeu, ni réseau social, ni actualités).
- Violence, peur, sexualité, langage grossier, substances (alcool, tabac, drogues), jeux d'argent : **Non** partout.
- Les utilisateurs peuvent-ils interagir ou échanger du contenu ? **Oui, de façon limitée** : les membres d'une même famille
  partagent une liste de courses (texte issu d'un catalogue et quantités). Aucun échange avec des inconnus, aucun contenu public,
  aucune messagerie.
- Partage de la position de l'utilisateur avec d'autres utilisateurs : **Non**.
- Achats numériques : **Non** (aucun achat dans l'application).
- Résultat attendu : classification tous publics (PEGI 3 / équivalent).

## 4. Public cible et contenu

- Tranche d'âge cible : **18 ans et plus** (les administrateurs et parents qui gèrent les courses du foyer). Ne pas cocher de
  tranche de moins de 13 ans : l'application n'est pas conçue pour les enfants et le programme « Familles » ne s'applique pas.
- L'application peut-elle attirer involontairement les enfants ? **Non**.
- Annonces : **L'application ne contient pas d'annonces**.
- Accès à l'application : **Fonctionnalités soumises à restrictions** (connexion requise) → instructions du § 6.
- Application d'actualités : Non. Application de santé : Non. Application financière : Non. Applications gouvernementales : Non.
- Fonctionnalités d'IA générative : Non.

## 5. URL publiques (vérifiées le 14 octobre 2026, en lecture seule)

| Usage | URL | Vérification |
|---|---|---|
| Règles de confidentialité | `https://smartcourse-production-c7ce.up.railway.app/confidentialite` | 200, HTML, page lisible sans connexion |
| Suppression de compte | `https://smartcourse-production-c7ce.up.railway.app/suppression-compte` | 200, HTML, formulaire sans connexion ; l'API répond `401 invalid_credentials` à des identifiants inexistants (aucune donnée modifiée). Suppression réelle vérifiée sur une famille jetable du serveur d'essai (section D du parcours final). |

Points à corriger avant soumission (préparés, **non déployés** — votre accord est nécessaire) :
1. Les pages s'intitulent encore « Courses » : Google demande que la page de suppression cite le **nom affiché sur la fiche**
   (« Mes Courses »). Corrigé dans `web/public/*.html` sur la branche `claude/android-native`.
2. La page de confidentialité décrit les notifications de l'application web (Firebase Cloud Messaging) ; l'application Android
   n'utilise aucun service de notification tiers. Corrigé dans la même modification.
3. **Adresse de contact publique absente** (« le contact public de l'application n'est pas encore renseigné ») : variable
   `CONTACT_EMAIL` du serveur à renseigner (changement de configuration Railway, redémarrage du serveur, aucune donnée touchée).

## 6. Compte de démonstration pour l'examen Google

À créer **par vous**, en production, avec une adresse e-mail dédiée que vous contrôlez (le code de vérification y est envoyé).
Création d'une famille = ajout de données en production : je ne l'ai pas fait.

1. Dans l'application : Première connexion → Créer ma famille.
   - Nom de la famille : `Famille Démo`
   - Votre prénom : `Camille` ; identifiant : `demo-admin` ; ville : au choix
   - E-mail de récupération : **l'adresse dédiée** ; code d'accès : 6 chiffres non utilisés ailleurs
2. Réglages → Profils → Ajouter un profil : `Nadia`, identifiant `demo-personnel`, rôle **Personnel**, autre code à 6 chiffres.
3. Ajouter quelques articles à la liste (pour que l'examinateur voie une liste non vide).

Texte à coller dans « Accès à l'application » (remplacer les crochets) :

```
L'application est réservée aux membres d'une famille. Pour la consulter :
1. Ouvrir l'application, écran « Bienvenue ».
2. Code famille : [CODE FAMILLE DE « Famille Démo »]
3. Identifiant : demo-admin
4. Code d'accès : [6 CHIFFRES]
5. Toucher « Se connecter ».
Rôle administrateur : liste partagée, ajout d'articles (catalogue avec photos), quantités, achats, historique, favoris, profils (Réglages → Profils).
Pour voir le rôle « Personnel de maison » : Compte (icône en haut à droite) → Se déconnecter, puis se connecter avec l'identifiant demo-personnel et le code [6 CHIFFRES].
Aucun abonnement, aucun paiement. Les données de ce compte sont fictives.
```

## 7. Informations manquantes (non inventées)

- Adresse e-mail de contact du développeur (fiche Play) et `CONTACT_EMAIL` du serveur.
- Compte développeur Google Play (nom du développeur affiché, vérification d'identité, adresse si compte organisation).
- Adresse dédiée au compte de démonstration, puis code famille et codes d'accès de ce compte.
- Choix de la signature d'application Play (option A ou B ci-dessus).
- Accord pour déployer la correction des pages légales.
- Pays de distribution et prix (gratuite).
