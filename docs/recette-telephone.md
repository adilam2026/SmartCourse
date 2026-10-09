# Recette sur téléphone : gérer le catalogue (≈ 10 minutes)

## Accès sans Railway (temporaire, gratuit)
Sur un ordinateur avec Docker : `scripts/recette-locale.sh`. Il construit l'application, démarre une base **jetable**, crée la famille d'essai (administrateur adil / 482913, parent lamiaa / 573918, personnel marie / 573918, une liste en cours) et affiche une adresse `https://….trycloudflare.com` à ouvrir sur le téléphone (tunnel Cloudflare gratuit, sans compte, valable tant que le script tourne). Le code famille est affiché. `scripts/recette-locale.sh --stop` efface tout. L'ordinateur doit rester allumé pendant la recette. Aucun service payant, rien sur Railway.

Matériel : **deux téléphones** (ou un téléphone et un ordinateur), l'application ouverte sur les deux.
- Téléphone A : profil **administrateur** (Adil).
- Téléphone B : second profil, d'abord **personnel**, puis **parent**.
Avant de commencer : une liste est en cours (Parent → créer une liste si besoin).

| # | Sur… | Action | Résultat attendu |
|---|---|---|---|
| 1 | A | Réglages → Catalogue → **+ Ajouter un article** | La feuille « Ajouter un article » s'ouvre ; **Enregistrer** est grisé tant que le nom est vide |
| 2 | A | Nom « Khobz », catégorie « Pain et petit-déjeuner » | Le clavier s'ouvre : le champ, **Enregistrer**, **Annuler** et ✕ restent visibles |
| 3 | A | **📷 Prendre une photo** : photographier un pain (ou **🖼️ Galerie**) | L'appareil photo s'ouvre ; l'aperçu montre la photo **entière** sur fond blanc |
| 4 | A | **Enregistrer** (essayer d'appuyer deux fois) | Un seul article créé ; la feuille se ferme ; « Khobz » apparaît dans le catalogue |
| 5 | B (personnel) | Rien à faire (ne pas recharger) | « Khobz » apparaît dans « Pain et petit-déjeuner » avec sa photo, en quelques secondes |
| 6 | B (personnel) | Toucher « Khobz » puis **Valider** | Il passe en « Enregistré sur le serveur » |
| 7 | A | Modifier « Khobz » : nouveau nom « Khobz complet », autre photo | L'aperçu montre la nouvelle photo ; après **Enregistrer**, B voit le nouveau nom et la nouvelle photo |
| 8 | A | Réglages → Catalogue → **Modifier** « Khobz complet » → **Image d'origine** puis annuler (ou enregistrer) | Pour un article d'origine : retour à l'image du catalogue ; pour un article ajouté : tuile neutre |
| 9 | A | **Modifier** « Khobz complet », décocher **Article actif**, **Enregistrer** | Le texte de la feuille explique la règle ; la ligne indique « désactivé » |
| 10 | B (personnel) | Regarder la liste | « Khobz complet » **reste** dans la liste en cours, marqué « désactivé » ; on peut encore le retirer tant qu'il n'est pas acheté |
| 11 | B (parent) | Se connecter en parent : « Khobz complet » → **Acheté** | L'achat est enregistré, malgré « désactivé » |
| 12 | A | Chercher un autre article désactivé (ex. « Carottes ») et le désactiver | Personne ne peut plus l'ajouter ; il disparaît des choix du personnel |
| 13 | B (parent) | Clôturer la liste, ouvrir **Historique** | Les noms, photos et catégories de la liste close sont **inchangés** (anciens noms conservés) |
| 14 | A | Mode avion, puis Modifier un article → Enregistrer | Message « Pas de connexion… », la feuille reste ouverte avec **toutes** les données saisies ; rétablir le réseau → Enregistrer réussit |
| 15 | B (personnel) | Menu du profil → **Crédits photos** | Une ligne « 80 visuels du catalogue : Image générée avec ChatGPT » |

Remise à zéro après la recette : réactiver (ou laisser désactivés) les articles d'essai ; aucun n'efface l'historique.

À signaler si une étape échoue : numéro de ligne, téléphone/navigateur, capture d'écran.
