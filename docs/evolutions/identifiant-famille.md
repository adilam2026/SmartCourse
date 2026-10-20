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
- Application 1166 (ancienne) avec le nouveau serveur : connexion par code famille ou par identifiant ; un administrateur qui crée
  un membre choisit encore un code permanent (comportement d'avant). Limite : un membre invité avec un code provisoire doit utiliser
  la nouvelle application (l'ancienne ne propose pas l'écran de choix du code).
- Nouvelle application avec l'ancien serveur (025) : connexion par code famille ; l'identifiant famille n'est pas proposé ; la
  création d'un membre affiche « Cette fonction nécessite la mise à jour du serveur ».
- Application web : connexion par identifiant ou code acceptée par le serveur ; ses écrans ne sont pas modifiés.

## Retour arrière

| Situation | Conduite | Données |
|---|---|---|
| Problème sur le nouveau serveur | Redéployer `reference/serveur-025` (64af689). La migration 026 reste en place : l'ancien serveur l'ignore (sa suite de tests passe sur un schéma 026, hors les deux contrôles de la liste des migrations) | Aucune donnée supprimée |
| Pendant le retour arrière | Connexion par **code famille** seulement (les identifiants ne sont pas lus par l'ancien serveur). Limite : l'ancien serveur ignore l'expiration et l'usage unique, donc un code provisoire non remplacé fonctionne (même expiré ou déjà utilisé) jusqu'au retour du nouveau serveur, qui rétablit alors l'obligation de choisir son code | — |
| Retour au nouveau serveur | Les familles créées entre-temps sont rattrapées au démarrage (code réservé comme alias) ; la connexion par code fonctionne même sans alias | Rien à faire |
| Application | Version construite depuis `reference/android-1.0.2-1166` avec un versionCode supérieur | — |
| Base de données | Jamais de restauration en production sans l'accord explicite du propriétaire | Copies protégées sous `backups-conservees/` |

Avant un déploiement : sauvegarde neuve vérifiée juste avant la migration (mécanisme déjà en place au démarrage du serveur).
