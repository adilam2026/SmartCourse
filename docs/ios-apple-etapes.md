# iPhone : accès Apple, étape par étape (de l'inscription au test APNs réel)

Rien n'est déployé en production : la première version TestFlight est reliée au **service de recette** (données fictives),
où l'envoi APNs est installé. Aucun secret n'est à copier dans une conversation : ils vont directement dans GitHub ou Railway.

---

## Étape 1 — Inscription Apple Developer

1. Sur **developer.apple.com/programs/enroll**, se connecter avec l'Apple ID qui publiera l'application
   (authentification à deux facteurs obligatoire).
2. Choisir le type de compte :
   - **Individuel** (le plus simple) : l'application est publiée sous votre nom ;
   - **Organisation** : publiée au nom d'une société, exige un numéro D-U-N-S (délai plus long).
3. Payer l'adhésion (99 $ par an), puis attendre l'e-mail de confirmation d'Apple (quelques heures à quelques jours).

➜ Me prévenir quand l'adhésion est active.

---

## Étape 2 — Identifiant et application

**2a. Identifiant de l'application** — developer.apple.com → *Certificates, Identifiers & Profiles* → *Identifiers* → « + » :
- *App IDs* → *App* → Description « Mes Courses » ;
- *Bundle ID* : **Explicit** = `app.smartcourse.courses` ;
- *Capabilities* : cocher **Push Notifications** seulement (rien d'autre n'est utilisé) → *Register*.

**2b. Fiche dans App Store Connect** — appstoreconnect.apple.com → *Apps* → « + » → *New App* :
- plateforme iOS ; nom « Mes Courses » (s'il est déjà pris sur l'App Store, un nom proche, ex. « Mes Courses en famille » ;
  le nom affiché sous l'icône reste « Mes Courses ») ;
- langue principale : français ; *Bundle ID* : `app.smartcourse.courses` ; *SKU* : `mescourses-ios` ; accès : complet.

---

## Étape 3 — Signature et secrets GitHub

### Pourquoi pas de rôle Admin

La première version du workflow utilisait la **signature gérée par Apple** (« cloud signing ») : Xcode y crée lui-même le
certificat et le profil de distribution, ce qu'Apple réserve par défaut aux rôles **Admin** / titulaire du compte. Pour
appliquer le **moindre privilège**, le workflow signe désormais avec un certificat et un profil que **vous** créez une fois ;
la clé API ne sert plus qu'à **envoyer** les versions, ce que permet le rôle **Developer**. Elle ne peut ni créer de certificats,
ni modifier l'application, ni gérer les utilisateurs. (Si Apple refusait l'envoi avec ce rôle, le niveau suivant serait
*App Manager*, jamais Admin.)

### 3a. Identifiant d'équipe
developer.apple.com → *Account* → *Membership details* → **Team ID** (10 caractères).

### 3b. Certificat de distribution (sous Windows, avec « Git Bash », installé avec Git)
Dans un dossier de travail personnel (jamais dans le dépôt) :
```bash
openssl genrsa -out distribution.key 2048
openssl req -new -key distribution.key -out distribution.csr -subj "/CN=Mes Courses Distribution/C=MA"
```
developer.apple.com → *Certificates* → « + » → **Apple Distribution** → envoyer `distribution.csr` → télécharger
`distribution.cer`, puis :
```bash
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -legacy -inkey distribution.key -in distribution.pem -name "Apple Distribution" -out distribution.p12
```
(choisir un mot de passe pour le `.p12`.)

### 3c. Profil App Store
*Profiles* → « + » → **App Store Connect** (Distribution) → App ID `app.smartcourse.courses` → le certificat créé en 3b →
nom « Mes Courses App Store » → télécharger le fichier `.mobileprovision`.
(L'identifiant doit déjà avoir *Push Notifications* coché, sinon le profil n'autorise pas les notifications ; le workflow le vérifie.)

### 3d. Clé API App Store Connect (rôle minimal)
App Store Connect → *Users and Access* → *Integrations* → *App Store Connect API* → *Team Keys* → « + » :
nom « GitHub TestFlight », accès **Developer** → télécharger le `.p8` (une seule fois possible) ; noter **Key ID** et **Issuer ID**.

### 3e. Secrets GitHub (environnement « testflight »)
Dans Git Bash : `base64 -w0 distribution.p12 > p12.txt` et `base64 -w0 "Mes_Courses_App_Store.mobileprovision" > profil.txt`.

GitHub → dépôt → *Settings* → *Environments* → *New environment* « **testflight** » (option conseillée : *Required reviewers* =
vous, pour approuver chaque envoi) → *Environment secrets* :

| Secret | Contenu |
|---|---|
| `APPLE_TEAM_ID` | Team ID (3a) |
| `ASC_KEY_ID` | Key ID de la clé API (3d) |
| `ASC_ISSUER_ID` | Issuer ID (3d) |
| `ASC_KEY_P8` | contenu complet du fichier `.p8` (3d) |
| `IOS_DIST_P12_BASE64` | contenu de `p12.txt` |
| `IOS_DIST_P12_PASSWORD` | mot de passe du `.p12` |
| `IOS_PROFILE_BASE64` | contenu de `profil.txt` |

Ensuite : garder `distribution.p12` et son mot de passe dans un gestionnaire de mots de passe (valable un an), supprimer les
autres fichiers du dossier de travail.

---

## Étape 4 — Premier envoi TestFlight

1. Me prévenir : je lance le workflow « iPhone — version finale et TestFlight » avec **envoi = oui, serveur = recette**.
   Le workflow vérifie le profil (identifiant, notifications), signe, envoie ; les secrets n'apparaissent jamais dans les journaux.
2. Apple traite la version (10 à 30 min) : App Store Connect → l'application → **TestFlight**. Aucune question de chiffrement
   (déclaré : chiffrement standard du système seulement).
3. *Internal Testing* → créer un groupe → vous y ajouter.
4. Sur l'iPhone : installer l'application **TestFlight**, accepter l'invitation, installer « Mes Courses ».
5. Connexion avec la famille fictive de recette : identifiant famille `RecetteCourses`, `adil` / `482913`.

---

## Étape 5 — APNs sur la recette, puis test réel sur l'iPhone

**5a. Clé APNs** — developer.apple.com → *Keys* → « + » → nom « Mes Courses APNs » → cocher **Apple Push Notifications
service (APNs)** → *Configure* : environnement **Production** (TestFlight et App Store utilisent l'environnement de production)
et, si proposé, restriction **à l'identifiant `app.smartcourse.courses`** (moindre privilège) → télécharger le `.p8`
(une seule fois), noter le **Key ID**.

**5b. Variables du service de recette** — Railway → projet `smartcourse-recette` → service → *Variables* :

| Variable | Valeur |
|---|---|
| `APNS_KEY_ID` | Key ID de la clé APNs |
| `APNS_TEAM_ID` | Team ID |
| `APNS_TOPIC` | `app.smartcourse.courses` |
| `APNS_KEY_P8` | contenu complet du `.p8` APNs |

Railway redémarre le service. La production n'est pas touchée.

**5c. Test réel** (les notifications simulées sur simulateur ne valent pas validation APNs) :
1. Sur l'iPhone (version TestFlight de recette), connecté en `adil` : *Réglages* → *Notifications et rappels* →
   **Nouvelles demandes** → *Autoriser*.
2. Fermer l'application, verrouiller l'iPhone, me prévenir.
3. J'ajoute un article à la liste en tant que `marie` (autre membre de la famille fictive) : une notification
   « … Marie a ajouté 1 produit » doit arriver en quelques secondes.
4. Puis, application ouverte : nouvelle notification, affichée en haut de l'écran.
5. Enfin, déconnexion de l'iPhone puis nouvel ajout par `marie` : **aucune** notification ne doit arriver (appareil retiré).
