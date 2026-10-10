# Application Android SmartCourse

**Type** : Trusted Web Activity (TWA). L'application Android est une vraie application installable (APK / AAB, icône « Courses », nom « Courses ») qui ouvre la PWA du serveur Railway **en plein écran, sans barre d'adresse**, dans Chrome. Elle réutilise l'application actuelle et le serveur : aucune réécriture, aucun second code à maintenir. Les mises à jour de l'application web arrivent sans réinstaller l'APK.

- Adresse : `https://smartcourse-production-c7ce.up.railway.app` (modifiable : `-PappUrl=…` ou l'entrée du workflow).
- Identifiant du paquet : `app.smartcourse.courses`. Android 7.0 (API 24) et plus. Chrome doit être installé et à jour (c'est le cas sur presque tous les téléphones Android).

## Ce que chaque fonction devient
| Fonction | Fonctionnement |
|---|---|
| Connexion persistante | Cookie de session de Chrome (même profil que la PWA) : reste connecté tant que la session serveur est valide |
| Galerie / appareil photo | Sélecteur de fichiers de Chrome (`<input type=file>` et `capture`). **Aucune permission déclarée** dans l'application : rien à accorder |
| Clavier | Les mêmes correctifs que la PWA (fiche qui suit la zone visible) |
| Bouton Retour | Ferme d'abord la fiche ouverte, quitte l'écran « Modifier la liste », revient à l'onglet « En cours » ; **depuis l'écran principal il quitte l'application** (comportement Android normal). Un formulaire non enregistré refuse Retour (Annuler/Enregistrer) |
| Hors connexion | Le service worker de la PWA (catalogue, photos, file d'envoi) |
| Icône | Icône adaptative (panier vert avec coche), ronde, et monochrome (icônes thématiques Android 13+) |

## Plein écran : assetlinks.json
Pour supprimer la barre d'adresse, Android vérifie que le site déclare l'application : `https://<adresse>/.well-known/assetlinks.json` doit contenir le paquet et l'**empreinte SHA-256 du certificat de signature**. Le fichier est `server/assetlinks.json` (public : une empreinte n'est pas un secret), servi par le serveur. **Il faut redéployer le serveur Railway avec le dernier commit** pour qu'il soit en ligne. Contrôle : ouvrir l'adresse `/.well-known/assetlinks.json` dans un navigateur.

Si la barre d'adresse s'affiche quand même : (1) fichier non en ligne, (2) empreinte absente (clé différente), (3) Chrome a mis le résultat en cache : désinstaller/réinstaller l'application.

**Google Play peut utiliser une clé de signature différente de la vôtre.** Si vous activez « Play App Signing » (recommandé), Google re-signe l'application avec **sa** clé. L'application installée depuis Google Play porte alors l'empreinte de **la clé de Google**, pas celle de l'APK direct : sans elle dans `server/assetlinks.json`, la version Play afficherait la barre d'adresse. Il faut donc ajouter l'empreinte SHA-256 du « certificat de signature d'application » (Play Console → Intégrité de l'application → Signature d'application) dans `server/assetlinks.json`, **à côté** de la première (les deux restent : APK direct et Play), puis redéployer le serveur. Si vous utilisez aussi le test interne Play avec la clé de téléversement, l'empreinte de téléversement n'a pas besoin d'y figurer.

## Signature (clé secrète hors du dépôt)
- Le dépôt ne contient aucune clé. La clé de production a été créée hors du dépôt (fichier `.jks` + mots de passe), à conserver **en deux exemplaires hors ligne** (gestionnaire de mots de passe + clé USB). **Perdre cette clé = ne plus pouvoir mettre à jour l'application sous le même identifiant.**
- Quatre secrets GitHub (Settings → Secrets and variables → Actions → *New repository secret*) : `ANDROID_KEYSTORE_B64` (le fichier `.jks` en base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= `smartcourse`), `ANDROID_KEY_PASSWORD`.
- Sans ces secrets, le workflow produit un APK **d'ESSAI** (clé jetable) : pour vérifier la construction, pas pour la famille.

## Construire (APK + AAB)
GitHub → Actions → **Application Android** → Run workflow. Le travail : construit l'APK release signé et l'AAB, vérifie la signature (`apksigner`), le contenu (paquet, nom, aucune permission sensible), valide l'AAB (`bundletool`), compare l'empreinte du certificat à `assetlinks.json`, regarde si la production publie le bon fichier, puis installe et lance l'APK sur un émulateur Android. Fichiers : onglet de l'exécution → *Artifacts* → `SmartCourse-android-production-N` (`SmartCourse.apk`, `SmartCourse.aab`, `empreinte-sha256.txt`). Le dépôt étant public, ces fichiers sont téléchargeables par tout compte GitHub : ils ne contiennent aucun secret (l'APK n'est de toute façon pas confidentiel).

## Installer l'APK sur un téléphone
1. Télécharger `SmartCourse.apk` (depuis GitHub sur le téléphone, ou l'envoyer par câble/messagerie).
2. L'ouvrir ; autoriser « Installer des applications inconnues » pour le navigateur ou le gestionnaire de fichiers utilisé (Android le propose).
3. Installer, ouvrir **Courses**, se connecter une première fois (code famille, identifiant, code à 6 chiffres).
4. Pour mettre à jour : installer le nouvel APK par-dessus (même clé, `versionCode` supérieur).

## Google Play (AAB)
Compte développeur Google Play (frais d'inscription uniques de Google, **à votre charge, non engagé ici**). Console → créer l'application → *Test interne* → envoyer `SmartCourse.aab` → activer Play App Signing → ajouter l'empreinte Google dans `assetlinks.json` (voir ci-dessus). Pour une publication hors test, Google demande une fiche (description, captures, politique de confidentialité, formulaire de sécurité des données) ; un compte personnel récent peut exiger une période de test fermé avec des testeurs avant la production : à vérifier dans la console à ce moment-là.

## Ce que les contrôles automatiques ne prouvent pas
Voir la liste « à vérifier sur un téléphone » dans le message de livraison : plein écran réel (dépend du serveur redéployé), caméra et galerie sur un vrai téléphone, clavier, Retour, hors connexion et reprise, mise à jour par-dessus.
