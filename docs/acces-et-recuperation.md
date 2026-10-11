# Accès, mots de passe et récupération par e-mail

## Règles
- **Administrateurs** : le bouton « Désactiver » n'existe pas pour un administrateur et le serveur refuse l'action (`admin_cannot_deactivate`). Pour désactiver un administrateur, on lui retire d'abord ce rôle (deux gestes volontaires).
- **Administrateur principal** (le premier de la famille, repéré par la migration 015 pour les familles existantes) : son rôle ne peut pas être modifié (`primary_admin_protected`), donc il ne peut jamais être désactivé. Un seul principal par famille (index unique).
- **Dernier administrateur actif** : toujours protégé (`last_admin`), y compris lors de modifications simultanées (verrou de la famille, testé 5 fois en parallèle).
- **Code secret — 6 chiffres** (nouveaux profils, changements, réinitialisation, première installation) : exactement **6 chiffres choisis à la main**, jamais générés ; second champ « Confirmer le code secret ». Clavier numérique, saisie masquée, zéros initiaux conservés (valeur traitée comme texte). Validé dans l'interface **et** sur le serveur ; codes trop simples (111111, 123456…) refusés ; 5 échecs = verrouillage, limites par IP inchangées.
- **Compatibilité** : les mots de passe existants (lettres, symboles) continuent de fonctionner et ne sont jamais modifiés automatiquement. Sur la connexion et la confirmation du mot de passe actuel, le lien « Clavier complet » bascule vers le clavier complet.
- Tests : serveur + e2e en émulation Android (Pixel 7) et iPhone (iPhone 14) ; les vrais claviers ne sont pas vérifiables en automatique (attributs `inputmode`, `type`, `autocomplete` contrôlés).
- **« Modifier le code secret »** (remplace « Nouveau code ») : deux champs ; l'ancien n'est jamais affiché ni renvoyé ; toutes les sessions du profil sont révoquées et ses flux temps réel coupés.
- **Connexion** : deux parcours séparés — *Se connecter* (code famille, identifiant, mot de passe) et *Première installation → Créer ma famille* (famille, premier administrateur, e-mail de récupération obligatoire ; l'autorisation d'installation arrive par le lien `/#/install/…`, jamais saisie).

## Récupération par e-mail
- L'**administrateur principal** enregistre une adresse (à la création de la famille ou dans Réglages → Adresse de récupération). Elle n'est utilisable qu'**après vérification** par un lien reçu à cette adresse (valable 48 h, usage unique ; changer d'adresse annule la vérification et les anciens liens).
- **Code famille oublié ?** : le code est envoyé à l'adresse vérifiée. **Mot de passe oublié ?** : un lien temporaire (**1 h, usage unique, un seul lien valide à la fois**) permet de choisir un nouveau mot de passe (code secret à 6 chiffres, saisi deux fois) ; sessions révoquées, verrou levé. **L'ancien mot de passe n'est jamais envoyé.**
- Réponse **identique** que l'adresse soit connue ou non (aucune énumération) ; jetons stockés **hachés** ; envoi en arrière-plan avec délai maximal ; 3 e-mails par heure et par adresse ; 5 demandes par heure et par IP. Seul le profil principal a une adresse de récupération : les autres profils passent par un administrateur (« Modifier le code secret »).
- Les liens ouvrent **SmartCourse** : `https://<domaine>/#/verify/<jeton>` et `/#/reset/<jeton>`. Le jeton est dans le **fragment** : il n'est jamais envoyé au serveur ni dans ses journaux ; l'application l'efface de la barre d'adresse après usage.

## Module Brevo (repris de Petits Héros)
Même client que `adilam2026/Kids` (`server/mail.js`) : API HTTPS `POST /v3/smtp/email`, pas de SMTP, **HTTPS imposé**, redirections refusées, délai maximal ; « accepté » seulement si Brevo répond **2xx avec un `messageId`** ; aucun journal de la clé, de l'adresse, du lien ni du jeton. Paramètres **propres à SmartCourse**, à créer **uniquement dans les variables du service SmartCourse sur Railway** (jamais dans le dépôt ni dans une réponse) :

| Variable | Rôle |
|---|---|
| `BREVO_API_KEY` | clé API Brevo (**secrète**) |
| `BREVO_FROM_EMAIL` | expéditeur **validé chez Brevo** |
| `BREVO_FROM_NAME` | nom affiché (défaut « SmartCourse ») |
| `APP_URL` | adresse de SmartCourse dans les liens (sinon le domaine public Railway ; jamais l'en-tête Host) |
| `MAIL_TIMEOUT_MS` | délai maximal de l'appel (défaut 10 000) |
| `BREVO_WEBHOOK_SECRET` | facultatif : jeton de l'adresse du webhook de retour |

Sans clé ou sans expéditeur valide, l'application fonctionne normalement : l'envoi est désactivé (`/health` indique `"mail":"off"`, l'écran de réglages le dit, l'état du dernier envoi est « non configuré »). Avec les variables, `/health` indique `"mail":"brevo"`.

## « Accepté » n'est pas « reçu »
Chaque envoi est journalisé (`email_log`, adresse masquée) avec son état, affiché dans Réglages :

| État | Sens |
|---|---|
| accepté | Brevo a pris le message en charge (HTTP 2xx + `messageId`). **Ce n'est pas une preuve de réception dans la boîte.** |
| remis | Brevo signale (webhook) que le serveur du destinataire l'a accepté — encore pas une preuve de lecture. |
| rejeté | rebond, blocage, spam, adresse invalide (webhook). Un rejet n'est jamais masqué par un « remis » ultérieur. |
| refusé | Brevo a refusé (clé invalide, expéditeur non validé, quota…) : le lien est invalidé. |
| inconnu | pas de réponse dans le délai : le message est peut-être parti, le lien est conservé jusqu'à son expiration. |
| non configuré | aucune clé : rien n'est parti. |

Pour activer « remis / rejeté » : dans Brevo → Transactional → Settings → Webhooks, adresse `https://<domaine>/api/email/brevo-webhook/<BREVO_WEBHOOK_SECRET>`, événements *delivered, hard bounce, soft bounce, blocked, spam, invalid*. La réception réelle dans la boîte mail se vérifie **à la main** (courriers indésirables compris) et dans Brevo → Transactional → Logs.

## E-mail non envoyé : ce que voit l'utilisateur, ce que garde le serveur
**À l'écran** (réglages, première installation, e-mail de test) : uniquement « L'e-mail n'a pas pu être envoyé. Veuillez réessayer dans quelques instants. » avec un seul bouton « Réessayer ». Jamais le nom du service d'envoi, de l'hébergeur, d'une adresse IP, de HTTPS, d'un statut HTTP ni une consigne de configuration. Un envoi réussi efface aussitôt l'erreur ; un envoi refusé n'est jamais annoncé comme envoyé. L'API ne renvoie pas non plus ces informations (`/health` indique seulement `"mail":"on"|"off"`).

**Dans les journaux du serveur** (Railway → Logs) : une ligne `mail.failed` avec `kind`, `status`, `cause` (en clair), `todo` (marche à suivre) et `detail` (statut et code du service, message nettoyé : ni clé, ni adresse, ni contenu), et `mail.sent` avec l'identifiant du message quand le service accepte. Au démarrage : `mail.config` (`on`/`off`). Cause fréquente : `cause: "IP du serveur non autorisée dans Brevo"` → dans Brevo, désactiver le blocage des adresses IP inconnues pour les clés API (réglage de sécurité du compte). **Aucune adresse IP n'est ajoutée automatiquement et aucune plage n'est autorisée** : le serveur Railway change d'IP, la désactivation du blocage évite toute intervention à chaque changement.

| `cause` dans les journaux | Correction |
|---|---|
| IP du serveur non autorisée | désactiver le blocage des IP inconnues pour les clés API (Brevo → Sécurité) |
| Clé API refusée | corriger `BREVO_API_KEY` (clé v3 complète, sans guillemets ni espace) |
| Compte non autorisé à envoyer | faire activer l'envoi transactionnel du compte |
| Expéditeur non autorisé | valider `BREVO_FROM_EMAIL` dans Brevo (adresse de son propre domaine) |
| Limite ou crédits atteints / panne | attendre, ou contrôler le plan |

## Tests simulés et test réel
- **Simulés** (automatiques, à chaque livraison) : le vrai client d'envoi parle à un faux service local qui reçoit les messages. On y vérifie : envoi, « réception » dans la boîte factice, ouverture du lien, passage à « Adresse vérifiée », et tous les cas de refus. Ils ne prouvent rien sur Brevo lui-même.
- **Réel** (à faire par vous, après la désactivation du blocage d'IP) : Réglages → Adresse de récupération → « Réessayer » ou « Renvoyer le lien », ouvrir le lien reçu dans la boîte mail réelle, constater « Adresse vérifiée », puis « Envoyer un e-mail de test » et constater sa réception. Tant que ce test réel n'est pas fait, la réception réelle n'est pas démontrée.

## Partage des accès (Réglages → Famille et profils)
- Après une création de profil ou un changement de code **réussis**, « Partager les accès » ouvre un récapitulatif : lien (adresse publique de l'application), code famille, identifiant, code secret saisi à l'instant. **« Partager par WhatsApp »** ouvre WhatsApp avec le message prérempli (la personne choisit le destinataire et envoie elle-même) ; **« Copier les accès »** est l'alternative.
- Le code n'existe qu'en mémoire de l'écran : jamais en base (seul son hachage), ni dans les journaux, ni dans le stockage local ; il est effacé à la fermeture du récapitulatif ou au départ de l'écran. Annuler le partage ne défait rien.
- Profil existant (code non disponible) : « Partager » donne lien, code famille et identifiant ; « Définir un nouveau code et partager » change le code puis ouvre les accès complets. L'ancien code n'est jamais retrouvé.
- Cartes compactes : nom (badge « Principal »), identifiant et rôle, « Modifier le code » / « Partager » ; rôle et désactivation dans « Modifier le profil » (jamais pour le principal ; un administrateur n'est jamais désactivable).
