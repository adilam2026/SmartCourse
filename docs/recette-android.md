# Recette de l'application installée sur Android

Pour tester l'**application installée** (icône, plein écran, fermeture/réouverture, mode avion), pas seulement une page dans le navigateur.

**Limite** : ces étapes sont vérifiées par un navigateur Chrome automatisé (installabilité, service worker, connexion HTTPS, flux temps réel, hors connexion : voir « Ce qui est vérifié automatiquement »). Elles n'ont **pas** été jouées sur un vrai téléphone Android : l'appareil photo réel, l'invite « Installer » et l'icône sur votre écran d'accueil sont à constater par vous.

## 0. Préparer l'accès (ordinateur avec Docker)
1. `scripts/recette-locale.sh` (voir `recette-telephone.md`). Il affiche une adresse `https://….trycloudflare.com`, le code famille et les identifiants d'essai.
2. **Ne l'arrêtez pas et ne mettez pas l'ordinateur en veille pendant toute la recette.** L'adresse change à chaque lancement : l'application installée reste liée à *cette* adresse.
3. Envoyez l'adresse à votre téléphone (message à vous-même, e-mail).

## 1. Ouvrir sur Android
1. Ouvrez l'adresse **dans Chrome** (appuyez sur le lien puis « Ouvrir avec Chrome » si une autre application s'ouvre).
2. L'écran de connexion de SmartCourse apparaît. Ne vous connectez pas encore.

## 2. Installer avec son icône
1. Menu **⋮** (en haut à droite de Chrome) → **Installer l'application** (parfois « Ajouter à l'écran d'accueil » → choisir **Installer**, et non « Créer un raccourci »).
2. Confirmez **Installer**. Quelques secondes plus tard, l'icône verte avec un panier coché, nom **Courses**, apparaît sur l'écran d'accueil (ou dans la liste des applications : la glisser sur l'écran d'accueil).
3. Fermez Chrome. **Ouvrez l'application par son icône** : elle s'ouvre en plein écran, **sans barre d'adresse**. C'est l'application installée ; toute la suite se fait ici.
   - Si l'option « Installer » est absente : rechargez la page, attendez 10 secondes, ouvrez le menu ⋮ de nouveau.

## 3. Se connecter et utiliser galerie / appareil photo
1. Connexion : code famille affiché par le script, identifiant `adil`, code `482913`.
2. Réglages → Catalogue → **+ Ajouter un article**.
3. **📷 Prendre une photo** : l'appareil photo d'Android s'ouvre (aucune autorisation spéciale n'est normalement demandée ; sinon, acceptez). Photographiez un pain, validez la photo : l'**aperçu** apparaît, image entière sur fond blanc.
4. **🖼️ Galerie** : le sélecteur de photos s'ouvre ; choisissez une image : l'aperçu se remplace.
5. Nom « Khobz », catégorie « Pain et petit-déjeuner », **Enregistrer** : la feuille se ferme, l'article apparaît.

## 4. Fermer puis rouvrir
1. Touche « Applications récentes » → faites glisser **Courses** hors de l'écran (fermeture complète).
2. Rouvrez par l'icône : vous êtes **toujours connecté** (session de 90 jours), la liste et le catalogue sont là, sans écran de chargement long.
3. Avec le profil `marie` (personnel) : choisissez deux articles **sans valider**, fermez l'application, rouvrez : les choix non validés sont **conservés** (brouillon local).

## 5. Mode avion et synchronisation
Préalable : application ouverte **en ligne** au moins 30 secondes (les images se mettent en mémoire).
1. Activez le **mode avion**. Ouvrez l'application : un bandeau « hors connexion » apparaît ; le catalogue **et ses images** s'affichent.
2. `marie` (personnel) : choisissez « Pain » et « Lait », **Valider** → l'état est « validé, en attente de synchronisation » (pas de fausse confirmation).
3. `lamiaa` (parent, sur un autre téléphone ou après changement de profil) : **Acheté** et **Corriger** sont **bloqués** hors connexion (règle convenue).
4. `adil` : Ajouter/Modifier un article → **Enregistrer** → message « Pas de connexion… » ; la feuille reste ouverte avec **toutes** les données.
5. Désactivez le mode avion. En quelques secondes : l'envoi part tout seul, `marie` voit « Enregistré sur le serveur », le second profil voit la liste mise à jour. `adil` peut maintenant **Enregistrer**.

## 6. Fin de recette
1. Désinstaller l'application d'essai : appui long sur l'icône → **Désinstaller** (ou Infos sur l'appli → Désinstaller).
2. Sur l'ordinateur : `scripts/recette-locale.sh --stop` (efface la base d'essai).

## Ce qui est vérifié automatiquement (GitHub Actions « Vérification du tunnel HTTPS »)
Sur un vrai tunnel HTTPS, depuis Chrome automatisé : page, manifeste « standalone », icônes 192/512 et « maskable », service worker, connexion avec cookie `Secure`, flux temps réel traversant le tunnel, envoi d'une photo d'environ 3 Mo, **verdict d'installabilité de Chrome**, ouverture hors connexion après un premier chargement.
