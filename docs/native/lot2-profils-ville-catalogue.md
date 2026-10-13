# Lot 2 — Profils, rôles, ville et catalogue (APK de recette `native-proto-19`)

Présentation validée conservée (aucun écran web). Branche `claude/android-native`, aucun déploiement, aucune donnée réelle.

## Opérationnel (réel, testé sur émulateur contre un serveur de recette isolé)
**Profils (Réglages → Profils, administrateur)**
- Liste réelle de la famille, rôles réels (administrateur principal, administrateur, parent, personnel), « Vous », « Désactivé ».
- Créer un profil (nom, identifiant, rôle, ville, code à 6 chiffres saisi deux fois) ; erreurs du serveur traduites : identifiant déjà pris, code trop simple, codes différents.
- Modifier le nom et le rôle ; modifier le code d'accès (les téléphones de la personne sont déconnectés).
- Désactiver (confirmation ; le serveur coupe aussitôt ses sessions) et réactiver ; supprimer (le profil est anonymisé en « Ancien profil », achats et historique conservés).
- **Protections appliquées par le serveur** (vérifiées par requêtes directes, pas seulement par l'interface) : le rôle, la désactivation et la suppression de l'administrateur principal sont refusés (409) ; un administrateur ne se désactive ni ne se supprime sans perdre d'abord son rôle ; on ne supprime pas son propre profil ici ; le dernier administrateur actif est protégé ; le personnel et les parents ne voient ni ne modifient les profils (403) ; une ville hors liste est refusée. L'application grise les actions impossibles avec les mêmes règles (`ProfileRules`, testées) et affiche le refus du serveur si elle se trompait.

**Ville**
- Ville du profil dans le menu « Compte » (« Ville : … · Modifier »), liste de 146 villes identique à celle du serveur (un test compare les deux fichiers), recherche sans accents ni casse (« fes » trouve Fès), enregistrée côté serveur ; choisie aussi à la création d'un profil.

**Catalogue (Réglages → Catalogue, administrateur)**
- Onglets Tous / Dans mon catalogue / À ajouter avec **compteurs réels** (243 / 80 / 163 au départ), qui suivent la recherche et la catégorie ; « Tous » : articles présents d'abord, puis absents.
- Recherche, catégories, défilement par pages (au-delà de 30 articles), vraies photos du serveur.
- Retirer (réversible, article conservé en base ; message « Annuler » de 8 s, visible au-dessus du clavier), Ajouter (réactive plutôt que de recréer).
- Rôles : le catalogue complet est refusé au personnel et aux parents (403).

**Serveur (seule modification)** : `GET /api/catalog/all` accepte `status` (active | inactive | absent | todo), `counts=1` et `presentFirst=1` ; test ajouté ; 296 tests serveur réussis.

**Accessibilité** : le champ de recherche annonce son texte indicatif aux lecteurs d'écran.

## Toujours simulé (données fictives, aucun serveur)
Liste administrateur et personnel, sélection, quantités, historique, gestion des prix, affichage, statistiques ; « Première connexion » (rejoindre / créer une famille), « Besoin d'aide » ; Récupération, Notifications, Sauvegarde, À propos (écrans à concevoir) ; création et modification d'un article du catalogue, photo d'article, « Supprimer mon compte » (non conçus dans la présentation validée).

## Tests
- 17 + 21 tests unitaires Android (client, session, règles de protection, villes, API) ; 296 tests serveur.
- Parcours de bout en bout sur émulateur Android 14 : lot 1 : 28/28 ; lot 2 : 58/58 (`docs/native/e2e-lot2/resultats.txt`) ; 0 plantage de l'application ; zones tactiles du personnel ≥ 48 dp sur 18 écrans.

## Limites connues
Aucun essai sur téléphone réel ; mise à jour en direct des profils et du catalogue (SSE) non branchée (bouton Actualiser, rechargement à chaque filtre) ; photos mises en cache par la bibliothèque d'images mais l'usage hors connexion du catalogue n'est pas encore conçu (lot « stockage local »).
