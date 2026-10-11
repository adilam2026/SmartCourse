# Mise en ligne sur Google Play — Courses

## Identité (définitive)
| Élément | Valeur |
|---|---|
| Nom sur Google Play (30 caractères max) | **Courses — Liste familiale** |
| Nom sous l'icône du téléphone | **Courses** |
| Identifiant de l'application (permanent) | **app.smartcourse.courses** (conservé : les téléphones qui ont déjà l'APK peuvent se mettre à jour) |
| Android minimum | 7.0 (API 24) · cible **API 36** |
| versionCode | numéro de l'exécution du workflow « Application Android », **plancher 7** (le dernier APK diffusé porte 6) |

## Clé de signature et mise à jour des téléphones qui ont déjà l'APK
L'APK déjà diffusé est signé par **votre clé** (empreinte `33:93:E6:53:…:AB:42:79`, celle de `server/assetlinks.json`). Android n'installe une mise à jour que si la **signature est identique**. Avec Google Play, deux choix à faire **au premier envoi**, avant toute publication :

| Choix | Conséquence |
|---|---|
| **A. Google crée sa clé de signature** (défaut de Play App Signing) ; votre clé devient la *clé de téléversement* | Le Play Store installe une application signée par **Google** : elle ne peut **pas** mettre à jour l'APK installé à la main (signatures différentes) → il faut **désinstaller puis réinstaller** (les données de la famille sont sur le serveur ; seuls les envois en attente hors connexion sont perdus). Ajouter l'empreinte Google dans `server/assetlinks.json` **à côté** de la première. |
| **B. Importer votre clé existante comme clé de signature Play** (*Exporter et importer une clé depuis un keystore Java*, outil PEPK de Google) | Les applications Play portent **la même signature** que l'APK actuel : mise à jour par-dessus, `assetlinks.json` inchangé. **Recommandé** si des téléphones ont déjà l'APK. Se fait sur **votre ordinateur** (le keystore et ses mots de passe n'en sortent pas) : Play Console → Intégrité de l'application → Signature d'application → choisir l'import, télécharger `pepk.jar` et la clé de chiffrement Google, puis `java -jar pepk.jar --keystore=<votre .jks> --alias=<alias> --output=cle-chiffree.zip --include-cert --rsa-awoc --signing-key-encryption-key=<clé Google>`. |

Décision à prendre **avant** le premier envoi : elle ne se change pas ensuite. Si aucun téléphone n'a l'APK de façon durable, A est plus simple.

## Fichiers à envoyer
Workflow **Application Android** → artefact `SmartCourse-android-production-N` : `SmartCourse.aab` (à envoyer sur Play), `SmartCourse.apk` (installation directe), `empreinte-sha256.txt`. Le workflow vérifie : signature, paquet, nom, niveau d'API cible ≥ 36, versionCode ≥ 7, aucune bibliothèque native (pages de 16 Ko), AAB et APK signés par la même clé, empreinte conforme à `assetlinks.json`, AAB valide (`bundletool`), puis une recette sur émulateur (voir ci-dessous).

## Fiche de l'application (à saisir dans la console)
- Catégorie : Maison et décoration… ou **Productivité** ; application gratuite ; sans publicités ; public cible : **adultes et familles** (pas une application pour enfants).
- Description courte (80 car.) : *La liste de courses partagée de la famille, même sans connexion.*
- Description : liste partagée en temps réel entre le personnel et les parents, achats et historique, catalogue de produits avec photos, notifications aux parents, fonctionne hors connexion.
- Politique de confidentialité : `https://smartcourse-production-c7ce.up.railway.app/confidentialite.html` (elle contient aussi la procédure de suppression des données).
- Suppression de compte / de données (formulaire « Sécurité des données ») : in-app *Réglages → Réinitialiser la famille* ; adresse web : même page, section « Supprimer vos données ».
- E-mail de contact du développeur : **votre adresse** (la console l'exige ; elle n'est pas dans le dépôt).

## Sécurité des données (réponses proposées)
| Donnée | Collectée | Partagée | Obligatoire | Usage |
|---|---|---|---|---|
| Adresse e-mail (récupération) | Oui | Oui — prestataire d'envoi d'e-mails (traitement pour notre compte) | Oui (administrateur principal) | Fonctionnement de l'application, gestion de compte |
| Nom (nom affiché), identifiants utilisateur | Oui | Non | Oui | Fonctionnement, compte |
| Photos (articles ajoutés par la famille) | Oui | Non | Non | Fonctionnement |
| Autres contenus (listes, achats, historique) | Oui | Non | Oui | Fonctionnement |
| Identifiants d'appareil / jeton de notification | Oui | Oui — service de notifications du système (traitement) | Non | Notifications |

Chiffrement en transit : **oui** (HTTPS). Suppression demandée par l'utilisateur : **oui** (voir ci-dessus). Pas de publicité, pas de revente, pas d'analyse comportementale.

## Autres déclarations
- Autorisations : seulement `POST_NOTIFICATIONS` (Android 13+, demandée au toucher de « Activer les notifications »). Caméra et galerie passent par le sélecteur de fichiers de Chrome : aucune autorisation.
- Classification du contenu : questionnaire standard (aucun contenu sensible) → tous publics.
- **Accès pour les relecteurs Google** : l'application exige une connexion. Fournir dans « Accès à l'application » un code famille et deux profils d'essai (parent et personnel) d'une **famille de démonstration** créée pour l'occasion (jamais votre famille réelle) et la supprimer après la validation.
- Un compte développeur personnel récent peut exiger un **test fermé** (testeurs, durée minimale) avant la production : à vérifier dans la console.

## Recette sur émulateur (automatique, dans le workflow)
`scripts/android-emulator-check.sh` installe l'APK sur Android 14 et vérifie : permission et service de **notifications**, **plein écran** (adresse vérifiée par Android → aucune barre d'adresse), réponse du serveur à une tentative de **connexion** (identifiants inconnus : rien n'est créé), un **lien d'e-mail** (faux jeton) attribué à l'application et reçu par la page, ouverture d'une adresse externe (**WhatsApp**), **ouverture hors connexion**.

**Non vérifiable automatiquement** (à faire sur un vrai téléphone) : connexion avec vos vrais identifiants, réception réelle d'une notification, ouverture réelle de WhatsApp avec le message prérempli (WhatsApp n'est pas installé sur l'émulateur), clic sur un lien dans l'application Gmail, mode avion avec envois en attente puis reprise.
