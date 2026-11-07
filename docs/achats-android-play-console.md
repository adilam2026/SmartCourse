# Achats Android — tests dans Play Console (sans attendre Apple)

Objectif : tester l'abonnement annuel (7 USD) et l'achat à vie (15 USD) avec de vrais paiements de test Google, sur le serveur
de **recette**. La production n'est pas touchée : quota, achats et mise à jour obligatoire y restent désactivés.

## 0. Ce qui est prêt

- **Application.**
  - Les écrans d'achat affichent les prix locaux renvoyés par Google Play : aucun montant n'est écrit dans l'application.
  - L'achat porte le jeton de la famille. Il est vérifié par le serveur, qui le confirme (acknowledge) auprès de Google.
  - « Restaurer les achats » et « Gérer l'abonnement » sont disponibles. Un paiement en attente est signalé.
- **Serveur.**
  - Vérification par l'API Google Play et notifications en temps réel.
  - Renouvellement, expiration, arrêt du renouvellement (accès jusqu'à l'échéance), période de grâce, suspension,
    remboursement, révocation, rapprochement toutes les 12 h.
- **Version de test.** Le workflow « Android — version de TEST des achats » produit un bundle :
  - identifiant réel `app.smartcourse.courses.natif`, signé par la clé durable ;
  - relié au serveur de recette, sans l'adresse de production (contrôlé) ;
  - publié en pré-version GitHub « TEST DES ACHATS ».

  Il ne doit aller **que** dans « Test interne », jamais en production. Le code de version est le plus haut publié + 1 : le
  prochain bundle de production devra le dépasser.

## 1. Play Console — dans cet ordre

Accès nécessaire : propriétaire du compte développeur, ou administrateur avec « Gérer les versions de test » et « Gérer la
monétisation ».

1. **Profil de paiement** — *Paramètres › Profil de paiements*. Le créer ou le lier : obligatoire pour vendre, même en test.
2. **Testeurs de licence** — *Paramètres › Test des licences*.
   - Ajouter les comptes Gmail qui feront les achats (les vôtres, pas ceux d'autres personnes).
   - « Réponse de licence » : `LICENSED`.

   Ces comptes paient avec des cartes de test : aucun débit réel.
3. **Envoyer la version de test** — *Tester et publier › Tests › Test interne*.
   - « Créer une version », puis importer `MesCourses-1.1.0-test-achats-NNNN.aab` (pré-version GitHub « TEST DES ACHATS »).
   - Notes : « Test des achats (serveur de recette) ».
   - Enregistrer puis « Examiner la version » et « Déployer en test interne ».

   C'est un envoi sur Google Play : il demande votre accord, et vous seul le faites. Il ne touche ni la production ni les
   testeurs fermés.
4. **Testeurs du test interne** — même page, onglet « Testeurs ».
   - Créer une liste d'adresses avec les mêmes comptes que l'étape 2, puis copier le lien d'inscription.
   - Chaque testeur ouvre ce lien, accepte, puis installe Mes Courses depuis Google Play. La version de recette « nativeproto »
     ne peut pas acheter : l'achat exige l'application installée depuis Google Play.
5. **Abonnement** — *Monétiser avec Play › Produits › Abonnements › Créer un abonnement*.
   - ID produit : `courses_famille_annuel`. Nom : « Mes Courses Famille — annuel ».
   - « Ajouter un forfait de base » :
     - ID `annuel` ;
     - type « Renouvellement automatique » ;
     - période de facturation **1 an** ;
     - délai de grâce 7 jours ;
     - suspension de compte : valeur par défaut ;
     - « Le forfait peut être modifié » : non.
   - « Définir les prix » : **7,00 USD**, puis « Mettre à jour les taux de change ». Google propose alors un prix local par pays
     (MAD, EUR…), arrondi selon les usages locaux ; vous pouvez l'ajuster. Activer le forfait de base.
   - Pas d'offre d'essai pour l'instant : l'application prend le forfait de base.
6. **Achat à vie** — *Monétiser avec Play › Produits › Produits ponctuels* (anciennement « Produits intégrés »).
   - « Créer un produit ponctuel », ID `courses_famille_a_vie`, nom « Mes Courses Famille — à vie ».
   - Option d'achat « Acheter », **15,00 USD**, puis « Mettre à jour les taux de change ». Activer.
   - Rien à cocher pour « non consommable » : l'application ne « consomme » jamais l'achat.
7. **Notifications en temps réel** (renouvellements, expirations, remboursements sans attendre l'application) :
   - Dans Google Cloud (projet lié à Play Console, *Paramètres › Accès API* ou *Configuration › Accès API*) :
     - créer un sujet Pub/Sub `play-rtdn` ;
     - y donner le rôle « Diffuseur Pub/Sub » à `google-play-developer-notifications@system.gserviceaccount.com` ;
     - créer un abonnement de type **Push** vers `https://smartcourse-recette-recette.up.railway.app/api/store/google/rtdn?token=JETON`.
       `JETON` est une longue valeur aléatoire choisie par vous, et saisie seulement ici et dans Railway (étape 9).
   - Dans Play Console, *Monétiser avec Play › Configuration de la monétisation* : nom du sujet
     `projects/ID_PROJET/topics/play-rtdn`, puis « Envoyer une notification de test ».
8. **Compte de service** (vérification par le serveur) :
   - Dans Google Cloud :
     - activer « Google Play Android Developer API » ;
     - créer un compte de service `mes-courses-achats`, puis une clé JSON (fichier gardé hors du dépôt).
   - Dans Play Console, *Utilisateurs et autorisations › Inviter de nouveaux utilisateurs* :
     - adresse du compte de service ;
     - onglet « Autorisations des applications », Mes Courses seulement ;
     - cocher « Afficher les données financières » et « Gérer les commandes et les abonnements ». Rien d'autre.
9. **Railway, service de RECETTE seulement** (*Variables*) :
   - `GOOGLE_PLAY_PACKAGE` = `app.smartcourse.courses.natif` ;
   - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` = contenu du fichier JSON ;
   - `GOOGLE_RTDN_TOKEN` = le `JETON` de l'étape 7.

   Railway redéploie la recette. Son journal de démarrage doit dire « Achats : Google Play configuré […] achats de test admis ».
   Ne rien ajouter au service de production.

Prévenez-moi après l'étape 9. Je vérifie alors, sans afficher de secret, que la recette interroge Google et reçoit la
notification de test.

## 2. Ce que fait la recette

- La règle des listes gratuites est active, les achats Android ouverts (`purchases-open android`), l'iPhone fermé.
- Famille d'essai : **RecetteQuota** (adil / 482913 administrateur, marie / 573918 personnel). Elle est à la limite : la création
  d'une liste ouvre l'écran d'achat.
- Les testeurs de licence peuvent créer leur propre famille de test depuis l'application : 10 listes gratuites, puis l'écran
  d'achat.

## 3. Plan de test (comptes testeurs, application installée depuis le test interne)

| # | Action | Attendu (application) | Attendu (serveur) |
|---|---|---|---|
| A1 | Administrateur, famille à la limite : « Créer une liste » | écran « Mes Courses Famille », prix locaux des deux offres | — |
| A2 | Membre non administrateur, même famille | message « Demandez à un administrateur », aucune offre | — |
| P1 | S'abonner, carte « toujours approuvée » | « débloqué pour toute la famille » | droit `annual` actif, renouvellement automatique, confirmé auprès de Google |
| P2 | Achat à vie, carte « toujours refusée » | message d'échec, rien de débloqué | aucun droit |
| P3 | Achat à vie, carte « approuvée après un délai » | « Paiement en attente » | droit `pending` (pas d'accès), puis actif à l'approbation (notification) |
| F1 | Autre membre, Android et iPhone | famille débloquée sans rien faire | même droit, aucun second paiement |
| R1 | Désinstaller, réinstaller, se reconnecter, « Restaurer les achats » | « Achats retrouvés et vérifiés » | même droit, aucune ligne en double |
| R2 | « Restaurer » depuis une **autre** famille avec le même compte Google | refus « déjà rattaché à une autre famille » | refus journalisé, droit inchangé |
| N1 | Attendre : en test, **1 an = 30 minutes**, jusqu'à 6 renouvellements | toujours débloqué | échéance repoussée à chaque renouvellement (notification) |
| N2 | Play Store › Paiements et abonnements › arrêter l'abonnement | « Renouvellement arrêté : accès jusqu'au … » | statut `cancelled`, accès jusqu'à l'échéance |
| N3 | Laisser passer l'échéance | création de liste à nouveau soumise à la limite, données intactes | statut `expired`, **pas** de nouveau lot gratuit |
| M1 | Abonné annuel : acheter à vie | avertissement « arrêtez votre abonnement » affiché avant l'achat | deux droits, le droit à vie prime |
| D1 | Play Console › *Commandes* : « Rembourser » + « Révoquer les droits » | famille de nouveau limitée au retour dans l'application | statut `refunded` ou `revoked`, définitif |
| D2 | Rembourser sans révoquer | idem dès la notification « annulée » | statut `refunded` |
| C1 | Hors connexion pendant l'achat, puis réseau revenu et ouverture de l'écran | débloqué sans racheter | achat présenté automatiquement, confirmé |

Contrôle côté serveur, sans données nominatives : `admin-cli store-status` (comptes par statut, refus des 30 derniers jours).
Le rapprochement peut être forcé avec `admin-cli store-reconcile`.

## 4. Activation par plateforme — comportement prévu

- Les achats s'ouvrent **séparément** pour Android et iPhone, sans nouvelle publication :
  - `admin-cli purchases-open android --min-version N --execute` ;
  - `admin-cli purchases-close android --execute`.

  `N` est le code de version de la première version Android qui sait acheter. Même principe pour `ios`, avec le numéro de build.
- Chaque application indique au serveur sa plateforme et sa version (« android/1250 »). Le serveur retient, pour chaque profil,
  les appareils utilisés.
- **Une famille n'est bloquée** à la limite des listes gratuites **que si au moins un de ses administrateurs** utilise un appareil
  qui permet d'acheter : plateforme ouverte et version suffisante.
- Sinon, par exemple :
  - administrateurs seulement sur iPhone alors que l'iPhone est fermé ;
  - administrateur avec une ancienne version Android ;
  - famille seulement sur le web.

  Dans ce cas, **rien n'est bloqué**. La création de listes continue, le compteur aussi, et l'écran indique « La création de
  listes reste possible pour le moment ». Le blocage s'applique dès qu'un administrateur ouvre une version qui permet d'acheter.
- **Membres non administrateurs** : ils ne comptent pas pour décider du blocage, puisqu'ils ne peuvent pas acheter.
  - Dans une famille bloquée, ils gardent la liste en cours, l'historique et toutes les données.
  - Seule la création d'une nouvelle liste les renvoie vers « Demandez à un administrateur ».
  - Avec une ancienne version Android (1188 ou avant), le refus vient du serveur, sans perte : les articles sont gardés.
- **Un achat fait sur une plateforme débloque toute la famille sur les deux**, sans second paiement. Un administrateur sur iPhone
  dont la famille a été débloquée sur Android voit « Abonnement souscrit sur Google Play : il se gère depuis cet appareil-là ».
- **Fermer une plateforme débloque aussitôt** les familles qui n'étaient bloquées que par elle.
- **Production** : les deux plateformes sont fermées et la règle des listes gratuites inactive. Rien ne change pour personne.

## 5. Mise à jour obligatoire — délai réel de la désactivation

- La désactivation côté serveur (`/gestion/mise-a-jour` ou `admin-cli update-disable`) est **immédiate sur le serveur**.
- Une application déjà bloquée et **laissée ouverte** sur l'écran « Mise à jour nécessaire » revérifie toutes les **30 secondes**.
  Elle se débloque seule, sans fermeture ni réinstallation : **30 s au plus**, plus la durée de la requête. Les contrôles
  automatiques exigent moins de 45 s.
- Une application en arrière-plan revérifie dès son retour au premier plan. Une application fermée revérifie à son ouverture.
- Sans réseau, l'écran reste tel qu'il était, puis se met à jour au premier échange réussi.
