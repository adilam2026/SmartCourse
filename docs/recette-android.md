# Recette de l'application installée sur Android

But : tester l'**application installée** (icône, plein écran, fermeture/réouverture, mode avion), pas une simple page dans le navigateur. Aucun déploiement Railway, aucune base Supabase : tout tourne sur **votre ordinateur**, temporairement, avec des données jetables.

## 0. État de la vérification (à lire d'abord)

**Vérifié automatiquement** (GitHub Actions, Chrome de bureau, vrai tunnel HTTPS Cloudflare, runs « Vérification du tunnel » n° 5 et 6) :
page et manifeste « standalone », icônes 192/512/« maskable », service worker, connexion avec cookie `Secure`, jugement d'installabilité de Chrome sans erreur, envoi d'une photo de 2,6 Mo, connexion de deux profils (personnel et parent), propagation d'une modification d'un profil à l'autre sans rechargement, relecture périodique, ouverture hors connexion.

**Pas de validation de bout en bout du tunnel avec la version actuelle du code.** Le dernier run du tunnel date d'avant : l'optimisation de la relecture (révision du catalogue, migration 008), le retrait de la directive `syntax` du Dockerfile et le repli de téléchargement des scripts. Seule la variante **sans tunnel** du script a tourné ensuite (run Docker n° 8 : construction, démarrage, 80 images, trois profils connectés).

**Non vérifié du tout** :
- tout ce qui se passe sur un vrai téléphone Android : l'invite « Installer », l'icône sur votre écran d'accueil, l'appareil photo réel, la galerie, le vrai clavier, le vrai mode avion, la fermeture depuis les applications récentes ;
- le flux temps réel (SSE) à travers le tunnel : il ne passe pas par le tunnel gratuit Cloudflare dans nos essais (0 octet reçu) ; la cause exacte n'est pas isolée ; la synchronisation repose alors sur une **relecture périodique de 8 s, sans garantie de délai** ;
- la migration 008 lue directement dans une exécution Docker : le contrôle explicite est écrit dans le script mais n'a pas encore tourné ;
- le téléchargement de l'image `cloudflare/cloudflared` sur votre machine, et son tunnel avec le code actuel.

## 1. Ce qu'il vous faut

Un **ordinateur avec Docker, qui reste allumé et connecté à Internet pendant toute la recette** :
- Docker Desktop (Windows ou Mac) ou Docker Engine (Linux), **démarré** ;
- un terminal « bash » : Linux/Mac natif ; sous Windows, **WSL2** ou **Git Bash** ;
- `git`, `curl` et `openssl` (présents par défaut sur Mac/Linux et dans Git Bash) ;
- ne pas laisser l'ordinateur se mettre en veille (réglages d'alimentation) : **veille ou arrêt = tunnel coupé = application inaccessible**.

Le téléphone n'a **pas** besoin d'être sur le même Wi-Fi : il passe par Internet, via l'adresse HTTPS du tunnel.

## 2. Obtenir l'adresse HTTPS

1. Sur l'ordinateur : `git clone https://github.com/adilam2026/SmartCourse.git`, puis `cd SmartCourse` et `git checkout claude/family-shopping-list-specs-eqevg8`.
2. Lancer : `scripts/recette-locale.sh`. La première fois : **plusieurs minutes** (construction de l'image, téléchargement des images PostgreSQL et Node).
3. À la fin, le script affiche : une adresse `https://….trycloudflare.com`, le **code famille** et les identifiants d'essai :
   - `adil` / `482913` : administrateur (peut aussi faire tout ce que fait un parent) ;
   - `lamiaa` / `573918` : parent ;
   - `marie` / `573918` : personnel.
   Une liste de courses est déjà en cours.
4. Envoyez l'adresse à votre téléphone (message à vous-même, e-mail).
5. **Ne fermez pas le terminal.** Pour tout arrêter et effacer : `scripts/recette-locale.sh --stop`.

Durée de validité : **tant que le script tourne et que l'ordinateur est allumé**. Cloudflare ne donne aucune durée garantie pour ce tunnel gratuit. **L'adresse change à chaque lancement.**

## 3. Installer l'application avec son icône (Android, Chrome)
1. Ouvrez l'adresse **dans Chrome**.
2. Attendez 10 à 20 secondes (premier chargement), puis menu **⋮** → **Installer l'application** (ou « Ajouter à l'écran d'accueil » → choisir **Installer**, et **non** « Créer un raccourci », qui n'installe rien).
3. Confirmez **Installer**. L'icône verte « Courses » (panier coché) apparaît sur l'écran d'accueil, ou dans la liste des applications (la faire glisser sur l'écran d'accueil).
4. Fermez Chrome, ouvrez l'application **par son icône** : plein écran, sans barre d'adresse. Toute la suite se fait ici.
5. Si « Installer » n'apparaît pas : rechargez la page, attendez 10 s, rouvrez le menu ⋮.

## 4. Tester les deux profils

**Un téléphone n'ouvre qu'un profil à la fois dans l'application installée** (une seule session par appareil). Pour voir deux profils en même temps, utilisez **un deuxième appareil** : le plus simple est le **navigateur de l'ordinateur**, qui ouvre la même adresse HTTPS.

- **Téléphone, application installée : `adil`** (administrateur) → ajoute des articles, achète, modifie le catalogue.
- **Ordinateur, navigateur : `marie`** (personnel) → sélectionne et valide des articles.
- Option : `lamiaa` (parent) sur l'ordinateur dans une fenêtre de navigation privée, en plus.

Parcours :
1. Téléphone : connexion `adil` (code famille affiché par le script).
2. Téléphone : Réglages → Catalogue → **+ Ajouter un article** → **📷 Prendre une photo** (l'appareil photo d'Android s'ouvre ; aucune autorisation spéciale n'est normalement demandée) ou **🖼️ Galerie** ; l'aperçu montre l'image entière sur fond blanc ; nom « Khobz », catégorie « Pain et petit-déjeuner » ; **Enregistrer**.
3. Ordinateur : connexion `marie` → « Khobz » doit apparaître **sans rechargement**, en quelques secondes (jusqu'à une dizaine, sans garantie : relecture périodique via le tunnel).
4. Ordinateur : toucher « Khobz », puis **Valider**.
5. Téléphone : l'article apparaît dans « À acheter » **sans rechargement** ; toucher **Acheté**.
6. Téléphone : modifier « Khobz » (nom, photo), puis le **désactiver** : l'ordinateur voit le changement ; l'article déjà dans la liste reste visible, marqué « désactivé ».

## 5. Fermer puis rouvrir
Applications récentes → faire glisser **Courses** hors de l'écran → rouvrir par l'icône : toujours connecté (session de 90 jours), liste et catalogue présents. Avec `marie` : choisir deux articles **sans valider**, fermer, rouvrir : les choix sont conservés.

## 6. Mode avion et synchronisation
Application ouverte **en ligne au moins 30 s** (mise en mémoire des images).
1. Mode avion → ouvrir l'application : bandeau hors connexion, catalogue **et images** affichés.
2. `marie` (sur le téléphone après changement de profil, ou sur l'ordinateur coupé du réseau) : choisir des articles → **Valider** → « en attente de synchronisation » (pas de fausse confirmation).
3. Parent/administrateur hors connexion : **Acheté** et **Corriger** sont bloqués (règle convenue).
4. Administrateur hors connexion : Enregistrer un article → message « Pas de connexion… », la feuille reste ouverte avec toutes les données.
5. Désactiver le mode avion : l'envoi reprend tout seul ; la propagation vers l'autre profil arrive à la relecture suivante (plusieurs secondes, **sans garantie**).

## 7. Fin
1. Désinstaller : appui long sur l'icône → **Désinstaller** (indispensable : l'application installée pointe vers l'ancienne adresse).
2. Ordinateur : `scripts/recette-locale.sh --stop` (efface la base d'essai).

## 8. Sans ordinateur allumé : option non réalisée
Un workflow GitHub pourrait garder le tunnel ouvert pendant une durée fixée (au plus quelques heures, limite des tâches GitHub) et afficher l'adresse dans ses journaux. Il n'existe pas ; il exposerait publiquement l'application d'essai (adresse aléatoire, données jetables) et **ne remplace pas un hébergement durable**. À décider par vous.
