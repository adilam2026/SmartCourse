# Identifiant famille et codes d'accès provisoires

Évolution validée sur maquette (10 écrans, octobre 2026). Branche de développement : `claude/identifiant-famille`.
**Non déployée.** Aucun déploiement en production, aucune publication Google Play et aucune modification de données réelles
sans l'accord explicite du propriétaire.

## Ce qui change

| Sujet | Avant | Après |
|---|---|---|
| Connexion | Code famille (8 caractères) · identifiant · code d'accès | **Identifiant famille** (ex. LesTaha04) · identifiant personnel · code d'accès personnel. L'ancien code famille reste accepté, sans limite de durée |
| Création de famille | Code famille tiré au hasard | Identifiant proposé d'après le nom, modifiable, vérifié pendant la saisie puis à la création ; code famille toujours créé |
| Familles existantes | — | Réglages → Identifiant famille : choix, puis modification avec confirmation. Chaque identifiant remplacé reste un **alias permanent** |
| Nouveau membre | Code choisi par l'administrateur | **Code provisoire** généré par le serveur : 7 jours, usage unique ; le membre choisit son propre code à la première connexion |
| Code oublié d'un membre | L'administrateur saisit ou génère un code | « Nouveau code provisoire » : l'ancien code cesse aussitôt de fonctionner, les sessions du membre sont fermées |
| Récupération par e-mail | Inchangée | Inchangée ; l'e-mail « code famille » cite aussi l'identifiant, « code oublié » accepte l'identifiant ou le code |

## Serveur (migration 026, additive)

- `family_aliases` : un seul espace de noms pour le code famille d'origine, l'identifiant actuel et les anciens identifiants.
  Clé = empreinte SHA-256 du nom en minuscules : unicité insensible à la casse garantie par la base, y compris pour des
  demandes simultanées (clé primaire). À la suppression d'une famille, seule l'empreinte reste : aucun nom n'est conservé,
  et aucun identifiant n'est jamais réattribué.
- `profiles` : `secret_temporary`, `secret_expires_at`, `secret_used_at` (code provisoire). Les profils existants ne sont pas
  concernés (`false`).
- `family_signups.family_login_id` : identifiant demandé à la création, revérifié au moment de créer.
- Routes : `POST /api/family-id/check` (disponibilité, limitée à 30 par minute et par adresse IP), `GET`/`PUT /api/family/login-id`
  (administrateurs), `POST /api/profiles/:id/provisional-code`, `POST /api/me/secret` (première connexion).
- Une session ouverte avec un code provisoire ne permet que le choix du code personnel (`secret_change_required` ailleurs).
- Messages de connexion inchangés : un seul message générique, que l'identifiant soit inconnu, le code faux ou le code provisoire
  expiré ou déjà utilisé.

## Compatibilité

- Toutes les familles, tous les membres, listes, budgets et historiques sont conservés tels quels : la migration ajoute une table
  et des colonnes, et enregistre chaque code famille existant comme alias (contrôlé par un test de migration sur une base remplie).
- **APK 1166 et site web, comptes existants** : connexion inchangée, par code famille ou par identifiant famille.
- **APK 1166 et site web, membre invité avec un code provisoire** : la connexion est refusée **sans ouvrir de session** et sans
  consommer le code (réponse 426 `app_update_required`, donnée seulement si les identifiants sont exacts ; sinon message générique).
  Rien ne permet donc de contourner le choix du code personnel.
  - Site web : « Ce code d'accès est provisoire : choisissez d'abord votre code personnel dans l'application Mes Courses (dernière
    version sur Google Play), puis connectez-vous ici avec ce code. »
  - APK 1166 : il ne sait afficher que ses messages intégrés ; pour cette réponse, il affiche « Une erreur inattendue est survenue.
    Réessayez. ». L'indication de mise à jour vient du message d'invitation reçu par WhatsApp : « Installez ou mettez à jour
    Mes Courses depuis Google Play… ».
  - Nouvelle application : elle déclare savoir faire choisir le code (`clientFeatures: ["provisional"]`) et affiche l'écran de choix.
- Nouvelle application avec l'ancien serveur (025) : connexion par code famille ; l'identifiant famille n'est pas proposé ; l'ajout
  d'un membre affiche « Cette fonction nécessite la mise à jour du serveur ».

## Retour arrière

**Cible : `reference/serveur-025-compat-026`** (commit `aa64651`) = serveur de production 64af689 + correctif minimal :
- connexion par identifiant famille (actuel ou ancien) ou par code famille ;
- **un code provisoire n'ouvre jamais de session** (réponse identique à un code faux) : aucune dégradation de sécurité ;
- l'administrateur peut débloquer un membre en lui choisissant un code (comme avant), ce qui lève le statut provisoire ;
- suppression d'une famille : identifiants réduits à leur empreinte ;
- migration 026 incluse ; suite de tests complète : 338 réussis, dont 3 propres au retour arrière.

| Situation | Conduite | Données |
|---|---|---|
| Problème sur le nouveau serveur | Redéployer `reference/serveur-025-compat-026`. Le schéma 026 reste en place | Aucune donnée supprimée |
| Membres avec un code provisoire non remplacé | Connexion refusée pendant le retour arrière ; l'administrateur peut leur choisir un code, ou attendre le retour du nouveau serveur (codes encore valables s'ils n'ont pas expiré) | Membres et données intacts |
| Retour au nouveau serveur | Familles créées entre-temps rattrapées au démarrage (code réservé comme alias) | Rien à faire |
| Application | Version construite depuis `reference/android-1.0.2-1166` avec un versionCode supérieur | — |
| Base de données | Jamais de restauration en production sans l'accord explicite du propriétaire | Copies protégées sous `backups-conservees/` |

**À ne pas utiliser** après la migration 026 : `reference/serveur-025` (64af689) seul, qui laisserait un code provisoire valable sans
limite. Si cela arrivait malgré tout, procédure ciblée (rien n'est supprimé ; à exécuter seulement avec l'accord du propriétaire) :
`UPDATE profiles SET secret_hash = '!' WHERE secret_temporary;` puis fermeture de leurs sessions
(`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND profile_id IN (SELECT id FROM profiles WHERE secret_temporary);`).
Ces membres redemandent un code à leur administrateur.

## Recette : parcours du personnel (P et J)

Les 22 échecs P/J de la recette complète venaient des tests, pas de l'application : écrits le 14/10, ils supposaient l'ancien
écran du personnel (liste d'articles nommés, sans recherche). Depuis les évolutions validées du 15/10 (affichage « Cartes, par
catégories » par défaut, recherche pour le personnel), les articles ne sont nommés qu'en affichage Liste : le test ne trouvait pas
« Tomates », rien n'était choisi, et toutes les étapes suivantes échouaient en cascade (mêmes 22 échecs sur la version 1166).
Les tests ont été mis à jour (passage en « Liste, tous les articles », présence de la recherche) et rejoués : voir le compte rendu.
