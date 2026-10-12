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
| **B. Importer votre clé existante comme clé de signature Play** (*Exporter et importer une clé depuis un keystore Java*) | Les applications Play portent **la même signature** que l'APK actuel : mise à jour par-dessus, `assetlinks.json` inchangé. **Recommandé** si des téléphones ont déjà l'APK. Procédure ci-dessous. |

### Procédure précise pour conserver la clé existante avec Play App Signing (choix B)
À faire sur **votre ordinateur** : le fichier `.jks` et ses mots de passe n'en sortent pas, et ne sont jamais envoyés à Claude ni mis dans le dépôt. Java (JDK 11+) est nécessaire.
1. Play Console → **Créer l'application** (nom « Courses — Liste familiale », langue française, application, gratuite).
2. **Tester et publier → Test interne → Créer une version** (ne pas publier en production). À l'étape « Signature d'application Play », choisir **Options de clé → Exporter et importer une clé depuis un keystore Java** (le choix est proposé *avant* le premier envoi de fichier).
3. Télécharger depuis cette page l'outil **`pepk.jar`** et la **clé de chiffrement publique** (`encryption_public_key.pem`).
4. Dans un terminal, depuis le dossier qui contient le keystore :
   `java -jar pepk.jar --keystore=VOTRE_CLE.jks --alias=VOTRE_ALIAS --output=cle-chiffree.zip --include-cert --rsa-aes-wrap --encryption-key-path=encryption_public_key.pem`
   (l'alias est la valeur du secret `ANDROID_KEY_ALIAS` ; le mot de passe est demandé au clavier).
5. Envoyer **`cle-chiffree.zip`** sur la page de Play Console (le fichier est chiffré pour Google).
6. Clé de **téléversement** : choisir « utiliser la même clé » (simple ; l'AAB produit par le workflow est signé avec cette clé) ou en créer une distincte plus tard (nécessite de changer les 4 secrets du dépôt).
7. Envoyer **`SmartCourse.aab`**. Play le re-signe avec votre clé : l'application installée depuis Play a la **même signature** que l'APK actuel (elle se met à jour par-dessus).
8. Contrôler : Play Console → **Intégrité de l'application → Signature d'application** : l'empreinte SHA-256 du « certificat de signature d'application » doit être exactement `33:93:E6:53:89:D6:C9:0B:70:05:B8:AC:62:7A:D1:F3:5C:B7:18:A8:6F:E5:B3:D3:F1:D6:BF:C8:5C:AB:42:79`. Relancer le workflow **Application Android** avec `play_cert_sha256` = cette empreinte : il échoue si elle manque dans `server/assetlinks.json` (dépôt ou production).
9. Garder la clé en **deux exemplaires hors ligne**. Perdre la clé de téléversement se récupère via Google ; perdre la clé de signature importée ne se récupère pas.

Décision à prendre **avant** le premier envoi : elle ne se change pas ensuite. Si aucun téléphone n'a l'APK de façon durable, A est plus simple.

## Fichiers à envoyer
Workflow **Application Android** → artefact `SmartCourse-android-production-N` : `SmartCourse.aab` (à envoyer sur Play), `SmartCourse.apk` (installation directe), `empreinte-sha256.txt`. Le workflow vérifie : signature, paquet, nom, niveau d'API cible ≥ 36, versionCode ≥ 7, aucune bibliothèque native (pages de 16 Ko), AAB et APK signés par la même clé, empreinte conforme à `assetlinks.json`, AAB valide (`bundletool`), puis une recette sur émulateur (voir ci-dessous).

## Fiche de l'application (à saisir dans la console)
- Catégorie : Maison et décoration… ou **Productivité** ; application gratuite ; sans publicités ; public cible : **adultes et familles** (pas une application pour enfants).
- Description courte (80 car.) : *La liste de courses partagée de la famille, même sans connexion.*
- Description : liste partagée en temps réel entre le personnel et les parents, achats et historique, catalogue de produits avec photos, notifications aux parents, fonctionne hors connexion.
- Politique de confidentialité : `https://smartcourse-production-c7ce.up.railway.app/confidentialite.html` (publique, sans connexion, jamais en cache).
- **URL de suppression de compte** (champ Play « Supprimer le compte ») : `https://smartcourse-production-c7ce.up.railway.app/suppression-compte.html` — chaque personne supprime **son seul profil** (code famille, identifiant, mot de passe), sans supprimer la famille. Dans l'application : profil → « Supprimer mon compte » ; un administrateur peut supprimer le profil d'un parent ou du personnel ; le profil principal ne se supprime qu'avec toute la famille (*Réglages → Réinitialiser la famille*).
- **Adresse de contact** : variable Railway `CONTACT_EMAIL` (adresse publique affichée sur les deux pages). **Non renseignée tant que vous ne l'avez pas confirmée** : les pages l'indiquent au lieu d'en inventer une, et la fiche Play ne doit pas être soumise avant. Le contact du développeur que Play exige est une saisie de la console.

## Sécurité des données — correspondance avec le code et les services réels
Vérifié dans le code (juin à octobre 2026) : aucune bibliothèque d'analyse, de publicité ni de journalisation de plantages ; aucune ressource externe chargée par l'application (ni polices, ni scripts) ; seuls services tiers : **Railway** (serveur, base, photos), **Brevo** (envoi d'e-mails), **service de notifications du système** (Firebase Cloud Messaging via Chrome). WhatsApp n'est qu'une adresse `wa.me` ouverte par un geste de l'administrateur (aucun envoi par l'application).

| Catégorie Play | Collectée | Partagée | Où dans le code | Remarque |
|---|---|---|---|---|
| Adresse e-mail | Oui (administrateur principal) | Oui, au prestataire d'e-mails qui agit pour nous | `profiles.recovery_email`, `recovery.ts`, `mail.ts` | Le prestataire reçoit l'adresse et le message ; un journal ne garde qu'une empreinte et une version masquée |
| Nom | Oui (nom affiché) | Non | `profiles.display_name` | Anonymisé à la suppression du profil |
| Identifiants utilisateur | Oui (identifiant, code famille) | Non | `profiles.login`, `families.code` | Le code secret n'est jamais conservé en clair (scrypt) |
| Photos | Oui, facultatif (photos d'articles) | Non | `photo_assets`, stockage Railway | Supprimées avec la famille |
| Autre contenu / activité dans l'application | Oui (listes, achats, historique, favoris, prix de la famille, préférences d'affichage) | Non | `lists`, `purchases`, `list_events`, `list_templates`, `family_prices`, `profiles.show_*` | Non utilisé pour la publicité ni l'analyse |
| Prix partagés à la communauté (facultatif) | Oui, seulement si un administrateur choisit « Partager ce prix » : produit du catalogue, prix, unité, conditionnement, date, ville et magasin facultatifs | Visible des autres familles **sous forme de médiane** de plusieurs familles ; jamais de nom, e-mail, code famille ni historique | `price_contributions` (empreinte opaque, retirée à la suppression de la famille) | Fonctionnement (prix indicatifs) |
| Identifiants d'appareil ou autres | Oui | Oui, au service de notifications du système | `push_subscriptions` (adresse d'abonnement, *user agent*) ; adresse IP dans les journaux et la limitation des essais | Facultatif : seulement si les notifications sont activées ; IP : journaux techniques temporaires |
| Localisation, contacts, fichiers, micro, caméra en continu, santé, finances | **Non** | — | — | La caméra et la galerie passent par le sélecteur de fichiers de Chrome |

Réponses : données chiffrées en transit (HTTPS) : **oui** ; suppression demandée par l'utilisateur : **oui** (page publique ci-dessus) ; pas de publicité ; pas de vente ni de partage à des fins commerciales ; finalités : fonctionnement de l'application, gestion de compte, sécurité (limitation des essais de connexion), notifications.

## Autres déclarations
- Autorisations : seulement `POST_NOTIFICATIONS` (Android 13+, demandée au toucher de « Activer les notifications »). Caméra et galerie passent par le sélecteur de fichiers de Chrome : aucune autorisation.
- Classification du contenu : questionnaire standard (aucun contenu sensible) → tous publics.
- **Accès pour les relecteurs Google** : l'application exige une connexion. Fournir dans « Accès à l'application » un code famille et deux profils d'essai (parent et personnel) d'une **famille de démonstration** créée pour l'occasion (jamais votre famille réelle) et la supprimer après la validation.
- Un compte développeur personnel récent peut exiger un **test fermé** (testeurs, durée minimale) avant la production : à vérifier dans la console.

## Recette sur émulateur (automatique, dans le workflow)
`scripts/android-emulator-check.sh` installe l'APK sur Android 14 et vérifie : permission et service de **notifications**, **plein écran** (adresse vérifiée par Android → aucune barre d'adresse), réponse du serveur à une tentative de **connexion** (identifiants inconnus : rien n'est créé), un **lien d'e-mail** (faux jeton) attribué à l'application et reçu par la page, ouverture d'une adresse externe (**WhatsApp**), **ouverture hors connexion**.

**Non vérifiable automatiquement** (à faire sur un vrai téléphone) : connexion avec vos vrais identifiants, réception réelle d'une notification, ouverture réelle de WhatsApp avec le message prérempli (WhatsApp n'est pas installé sur l'émulateur), clic sur un lien dans l'application Gmail, mode avion avec envois en attente puis reprise.

## Certificat de signature d'application Google Play (constaté)
Play Console affiche pour **Courses** le certificat de signature d'application SHA-256
`4E:E7:9A:55:D6:11:80:C2:6A:25:30:DD:AD:3E:12:17:35:EA:25:E2:F1:34:B4:41:95:C4:68:F8:3E:E1:7A:33`.
Il est **différent** de celui de l'APK distribué directement (`33:93:E6:…:AB:42:79`) : Google signe avec **sa** clé (choix A ci-dessus). `server/assetlinks.json` contient **les deux** empreintes pour `app.smartcourse.courses` : l'application Play et l'APK direct s'ouvrent en plein écran.
Conséquence : une installation faite depuis Play **ne peut pas mettre à jour** un APK installé à la main (signatures différentes) : sur ces téléphones, désinstaller l'APK puis installer depuis Play (les données de la famille sont sur le serveur).
Aucune clé de signature n'a été modifiée.
