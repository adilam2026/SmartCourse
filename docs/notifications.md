# Notifications téléphone (parents et administrateurs)

## Ce que ça fait
Une notification **récapitulative par validation réussie**, sur les téléphones des **autres** parents et administrateurs **de la même famille** :
- première validation de la liste : « **Nouvelle liste de courses** — Marie a validé 5 produits » ;
- suivantes : « **Liste mise à jour** — Marie a ajouté 3 produits et modifié 2 quantités » (aussi « retiré N produit(s) ») ;
- une validation faite par un parent ou un administrateur prévient les autres de la même façon.

Jamais : de notification au personnel, à l'auteur (sur aucun de ses appareils), pour une sélection ou un appui sur + / −, quand rien n'a changé (produit déjà présent, refus, achat, liste clôturée), ni deux fois pour la même validation. Un envoi fait hors connexion notifie **quand le serveur l'a enregistré** (pas à l'appui), une seule fois même si le téléphone renvoie le lot après une réponse perdue.

Au toucher : la liste en cours s'ouvre (onglet « En cours ») ; si elle est clôturée, son historique ; si la session a expiré, la connexion est demandée puis la liste s'ouvre ; la liste d'une autre famille ne s'ouvre jamais.

## Architecture (une vraie notification push, pas du rafraîchissement)
| Élément | Rôle |
|---|---|
| **Web Push (standard W3C, VAPID)** | Le serveur Railway envoie un message chiffré au service push du navigateur du téléphone. Sur Android/Chrome, ce service est **Firebase Cloud Messaging de Google, gratuit, sans compte ni projet Firebase à créer** : l'adresse d'envoi est fournie par Chrome au moment de l'abonnement. |
| **Clés VAPID** | Créées par le serveur au premier démarrage, gardées dans la base Railway (table `push_config`). Rien à configurer. (Possibilité de les imposer avec `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.) La clé privée est dans la base, donc dans les sauvegardes internes : ne pas les partager. |
| **Service worker** (`push-sw.js`, importé par `sw.js`) | Affiche la notification même application fermée, puis ouvre la liste au toucher. Même `tag` pour une même validation : une livraison en double remplace la notification. |
| **Application Android (APK)** | **Nouvel APK nécessaire** : il déclare la *délégation des notifications* (Chrome → application) et l'autorisation Android « Notifications » (Android 13+). Les notifications s'affichent alors comme celles de l'application « Courses ». |
| **Base** (migration 012) | `push_subscriptions` (un appareil = une adresse, rattaché à un seul profil), `push_events` (une ligne par validation : empêche tout doublon et garde le texte envoyé), `push_config`. Aucune donnée existante modifiée. |

Coût : **0**. Aucun service ni hébergement supplémentaire, Railway reste seul pour le serveur, la base et le stockage. Contenu des messages : prénom de la personne et nombres seulement (pas de noms de produits), chiffré de bout en bout vers l'appareil.

## Destinataires — décidés côté serveur
Requête à l'envoi : même famille que la liste, profil **actif**, rôle **parent ou administrateur**, différent de l'auteur. Le serveur refuse l'abonnement du personnel (403). Un profil désactivé ou passé au rôle personnel perd immédiatement ses abonnements. Un appareil n'appartient qu'à un profil : s'abonner depuis un autre profil le reprend ; à la connexion, `POST /api/push/subscriptions/check` libère un appareil resté au nom d'un ancien profil. À la déconnexion, l'application annule d'abord l'abonnement **du téléphone** (le service push refuse alors tout envoi), puis informe le serveur.

## Activer (parents et administrateurs)
1. Installer le **nouvel APK** par-dessus l'ancien (même clé : mise à jour sans perte).
2. Ouvrir l'application, se connecter. Sur « En cours », la bannière « Recevoir une notification quand la liste change ? » propose **Activer les notifications** (ou : avatar → Notifications → Activer).
3. Accepter la fenêtre Android « Autoriser Courses à envoyer des notifications ».
4. Plusieurs téléphones : refaire sur chacun. Désactiver : avatar → Notifications → « Désactiver sur cet appareil ». Si Android a refusé : Paramètres → Applications → Courses → Notifications.

## Limites réelles (pas de livraison instantanée garantie)
- Livraison « au mieux » par le service de Google : en général en quelques secondes, parfois plus ; si le téléphone est éteint ou sans réseau, le message est conservé **24 h** puis abandonné.
- **Fermeture normale** (retirer l'application des applications récentes) : les notifications arrivent. **Arrêt forcé** (Paramètres → Applications → Courses → *Forcer l'arrêt*) : Android bloque tout jusqu'à la prochaine ouverture de l'application ; c'est une limite du système, pas un défaut. Idem si l'économiseur de batterie *restreint* Chrome ou Courses, ou si les notifications de Chrome sont coupées.
- Chrome doit être installé et activé (c'est lui qui reçoit le message). Sans connexion à Internet : rien n'arrive avant le retour du réseau.
- Une notification n'est jamais renvoyée si elle a été manquée ; la liste, elle, reste toujours à jour à l'ouverture.

## Vérifié automatiquement / à vérifier sur téléphone
Automatique : serveur (destinataires, famille, auteur, personnel, doublons, rejeu, hors connexion, erreurs 410/500, transport Web Push réel chiffré et signé VAPID reçu par un faux service push et déchiffré), navigateur (autorisation, état, activation/désactivation, déconnexion, rôle, réception d'un vrai événement push par le service worker, pas de doublon, toucher → liste en cours / clôturée / après connexion / autre famille), manifeste de l'APK (permission, `DelegationService`). **Non vérifiable ici** : la remise par Firebase Cloud Messaging jusqu'à un vrai téléphone, l'invite Android, l'affichage de la notification par l'application et le toucher depuis l'écran de verrouillage : à vérifier sur le téléphone (voir le message de livraison).
