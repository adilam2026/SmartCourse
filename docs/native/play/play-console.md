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

> **Mise à jour requise pour la version 1166 (module Budget, pays de la famille, rappels)** — à saisir dans la Play Console
> *avant* d'envoyer l'AAB 1166 en examen. Lignes modifiées ou ajoutées ci-dessous marquées **[1166]**. Le module Budget est
> facultatif et désactivé par défaut, mais Google demande de déclarer tout type de données que l'application *peut* collecter.

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
| Position → **Position approximative** **[1166]** | **pays de la famille** choisi dans une liste et, au Maroc seulement, ville choisie dans la liste (pas de GPS, aucune permission de position), pour le catalogue, les prix indicatifs et la devise proposée | Oui | Fonctionnalité de l'application |
| Informations financières → **Historique des achats** **[1166]** | articles achetés, quantités, prix indicatifs, auteur et heure de l'achat ; **si le Budget est activé : paiements enregistrés pour une liste (montant payé, date, magasin, auteur)** | Oui | Fonctionnalité de l'application |
| Informations financières → **Autres informations financières** **[1166, nouveau]** | module Budget : dépenses et entrées saisies (montant, devise, catégorie, magasin, libellé, note, date), solde de départ de « Mon compte », budgets mensuels par catégorie, historique des corrections et annulations, droits financiers de chaque profil. **Aucune** carte bancaire, aucun numéro de compte, aucun accès bancaire, aucun paiement réel | **Non (facultatif)** : l'utilisateur choisit (option désactivée par défaut, activée par un administrateur) | Fonctionnalité de l'application |
| Activité dans l'application → **Autre contenu généré par l'utilisateur** **[1166]** | listes (**et leurs noms** avec « Plusieurs listes actives »), demandes, quantités, favoris, préférences d'affichage | Oui | Fonctionnalité de l'application |

Pour chaque type : **collecté = oui**, **partagé = non**, **traité de façon éphémère = non**.

Non collectés : position précise, contacts, photos et vidéos (l'application Android n'envoie aucune photo ; elle affiche
celles du catalogue), fichiers, agenda, santé, messages, audio, identifiants d'appareil ou publicitaires, rapports de
plantage, diagnostics. **[1166]** Les rappels d'achat (jours et horaires) restent **sur le téléphone** : ils ne sont pas envoyés
au serveur et ne sont pas à déclarer ; au déclenchement, l'application lit seulement la liste de la famille. Le code d'accès n'est jamais conservé en clair (empreinte seulement) ; Google ne demande pas de le
déclarer comme type distinct, mais il relève de la gestion du compte.

### Suppression et conservation (réponses « Suppression des données » et texte d'aide)

- **Suppression d'un compte** (dans l'application ou sur `/suppression-compte`) : nom, identifiant, code d'accès, ville,
  réglages, adresse e-mail éventuelle, liens et journal des e-mails, demande de création et abonnements aux notifications
  sont effacés immédiatement ; sessions fermées, reconnexion refusée. Les listes et achats, qui appartiennent à la famille,
  restent sous « Ancien profil ».
- **Suppression de la famille** (administrateur principal) : toutes les données de la famille sont effacées immédiatement,
  **[1166]** y compris toutes les données du Budget (opérations, historique des corrections, budgets, « Mon compte », catégories,
  magasins, droits financiers, réglages).
- **[1166] Données du Budget à la suppression d'un compte** : les opérations appartiennent à la famille et restent, sous
  « Ancien profil », comme les achats. Une opération n'est jamais effacée individuellement : elle est annulée de façon traçable.
  Désactiver le Budget masque le module sans effacer ses données.
- **Conservation** : demandes de création de famille et e-mails de code effacés par le serveur au-delà de 30 jours (au
  démarrage puis toutes les 6 heures). Aucune durée n'est annoncée pour les sauvegardes ni pour les journaux de l'hébergeur
  (non vérifiées).
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
| `android.permission.POST_NOTIFICATIONS` | application | Notifications facultatives des nouvelles demandes (parents et administrateurs) et **[1166] rappels d'achat** choisis par chaque profil ; demandée seulement si l'utilisateur les active. |
| `android.permission.WAKE_LOCK` | WorkManager | Laisser finir la vérification périodique en arrière-plan. |
| `android.permission.RECEIVE_BOOT_COMPLETED` | application **[1166]**, WorkManager | Reprogrammer la vérification périodique et **les rappels d'achat** après un redémarrage, une mise à jour de l'application ou un changement d'heure. Pas d'alarme exacte (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` non demandées) : aucune déclaration spéciale. |
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
- **[1166] Déclaration « Fonctionnalités financières »** (*Règles et programmes → Contenu de l'application*, obligatoire pour
  toutes les applications) : cocher **« Mon application ne propose aucune fonctionnalité financière »**. Le module Budget est un
  carnet de suivi des dépenses saisies à la main : pas de paiement, de virement, de prêt, de crédit, de banque, de portefeuille,
  de cryptomonnaie, de bourse ni d'assurance, et aucune connexion à un compte bancaire. Si la console propose une rubrique de
  gestion budgétaire ou de suivi des dépenses personnelles sans service financier, la choisir à la place ; ne jamais cocher une
  catégorie de service réglementé.
- **[1166] Catégorie de l'application** : garder la catégorie actuelle (le Budget est une fonction secondaire et facultative).
- Fonctionnalités d'IA générative : Non.

## 5. URL publiques (vérifiées le 14 octobre 2026, en lecture seule)

| Usage | URL | Vérification |
|---|---|---|
| Règles de confidentialité | `https://smartcourse-production-c7ce.up.railway.app/confidentialite` | 200, HTML, page lisible sans connexion |
| Suppression de compte | `https://smartcourse-production-c7ce.up.railway.app/suppression-compte` | 200, HTML, formulaire sans connexion ; l'API répond `401 invalid_credentials` à des identifiants inexistants (aucune donnée modifiée). Suppression réelle vérifiée sur une famille jetable du serveur d'essai (section D du parcours final). |

Corrections déployées le 14 octobre 2026 (serveur 43445da) :
1. Les pages s'intitulent encore « Courses » : Google demande que la page de suppression cite le **nom affiché sur la fiche**
   (« Mes Courses »). Corrigé et déployé.
2. La page de confidentialité décrit les notifications de l'application web (Firebase Cloud Messaging) ; l'application Android
   n'utilise aucun service de notification tiers. Corrigé et déployé.
3. Adresse de contact publique : **adilam.pro@gmail.com** (choisie par le propriétaire, affichée sur les deux pages ;
   une variable Railway `CONTACT_EMAIL` la remplacerait si elle était définie).

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

- Compte développeur Google Play (nom du développeur affiché, vérification d'identité, adresse si compte organisation).
- Adresse dédiée au compte de démonstration, puis code famille et codes d'accès de ce compte.
- Choix de la signature d'application Play (option A ou B ci-dessus).
- Accord pour déployer la correction des pages légales.
- Pays de distribution et prix (gratuite).
