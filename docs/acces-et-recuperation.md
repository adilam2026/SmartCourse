# Accès, mots de passe et récupération par e-mail

## Règles
- **Administrateurs** : le bouton « Désactiver » n'existe pas pour un administrateur et le serveur refuse l'action (`admin_cannot_deactivate`). Pour désactiver un administrateur, on lui retire d'abord ce rôle (deux gestes volontaires).
- **Administrateur principal** (le premier de la famille, repéré par la migration 015 pour les familles existantes) : son rôle ne peut pas être modifié (`primary_admin_protected`), donc il ne peut jamais être désactivé. Un seul principal par famille (index unique).
- **Dernier administrateur actif** : toujours protégé (`last_admin`), y compris lors de modifications simultanées (verrou de la famille, testé 5 fois en parallèle).
- **Mot de passe** : exactement **6 caractères visibles** (chiffres, lettres, symboles ; ni espace ni caractère de contrôle), saisi **deux fois**, choisi par l'administrateur ; **aucune génération automatique** (sauf la procédure de secours de l'exploitant, `admin-cli`). Les codes à 6 chiffres actuels restent valides. Les verrouillages après 5 échecs et les limites par IP sont inchangés.
- **« Modifier le mot de passe »** (remplace « Nouveau code ») : deux champs ; l'ancien n'est jamais affiché ni renvoyé ; toutes les sessions du profil sont révoquées et ses flux temps réel coupés.
- **Connexion** : deux parcours séparés — *Se connecter* (code famille, identifiant, mot de passe) et *Première installation → Créer ma famille* (jeton d'installation, famille, premier administrateur, e-mail de récupération recommandé).

## Récupération par e-mail
- L'**administrateur principal** enregistre une adresse (à la création de la famille ou dans Réglages → Adresse de récupération). Elle n'est utilisable qu'**après vérification** par un lien reçu à cette adresse (valable 48 h, usage unique ; changer d'adresse annule la vérification et les anciens liens).
- **Code famille oublié ?** : le code est envoyé à l'adresse vérifiée. **Mot de passe oublié ?** : un lien temporaire (**1 h, usage unique, un seul lien valide à la fois**) permet de choisir un nouveau mot de passe (6 caractères, saisi deux fois) ; sessions révoquées, verrou levé. **L'ancien mot de passe n'est jamais envoyé.**
- Réponse **identique** que l'adresse soit connue ou non (aucune énumération) ; jetons stockés **hachés** ; envoi en arrière-plan avec délai maximal ; 3 e-mails par heure et par adresse ; 5 demandes par heure et par IP. Seul le profil principal a une adresse de récupération : les autres profils passent par un administrateur (« Modifier le mot de passe »).
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
