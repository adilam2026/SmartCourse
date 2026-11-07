# Espace plateforme — mise en production (procédure préparée, rien n'est exécuté sans accord)

Ordre : **1. serveur**, puis **2. droit plateforme**, puis **3. bundle Android**. Chaque étape demande l'accord du propriétaire.
Aucun e-mail n'est écrit dans ce dépôt : la commande de recherche se tape directement dans le conteneur de production.

## 0. Déjà vérifié (avant toute production)

- **Tests serveur** : 437 réussis, dont ceux de l'espace plateforme :
  - accès refusé aux autres administrateurs (même famille et autres familles) et sans session ;
  - retrait du droit ;
  - déduplication et totaux.
- **Build Android de recette** (contrôle PL, serveur jetable, données fictives), pour le profil autorisé :
  - entrée « Espace plateforme » visible ;
  - « Photos manquantes » non vide ;
  - « Usage de l'application » avec le classement des familles.
- **Autre administrateur de la même famille** : entrée absente et API refusée (403).
- **Répétition du déploiement** sur une copie isolée de la dernière sauvegarde de production (schéma 030 → 035) :
  - données des familles inchangées ;
  - quota désactivé (aucune famille démarrée) ;
  - aucun droit payant ;
  - achats fermés (Android et iPhone) ;
  - mise à jour obligatoire désactivée ;
  - aucun droit plateforme ;
  - un jeton store distinct par famille.

## 1. Déploiement du serveur (après accord)

1. Avance rapide de la branche de production vers le commit validé de `claude/ios-kmp` (la production en est un ancêtre direct) :
   `git push origin <commit validé>:claude/family-shopping-list-specs-eqevg8`.
2. Railway redéploie la production ; au démarrage, les migrations 031 à 035 sont appliquées.
3. Vérifier, en lecture seule, que `https://smartcourse-production-c7ce.up.railway.app/health` indique le schéma
   `035_platform_space.sql` et le bon commit.
4. Dans le conteneur de production (`railway ssh`, dossier `/app/server`) :
   - `node dist/admin-cli.js quota-status` doit indiquer `"enabled":false` ;
   - `node dist/admin-cli.js purchases-status` : Android et iPhone fermés ;
   - `node dist/admin-cli.js update-status` : blocage désactivé sur les deux plateformes ;
   - `node dist/admin-cli.js platform-status` : aucun droit attribué.
5. Retour arrière :
   - **réversible tant que le droit n'est pas attribué** : remettre la branche de production sur l'ancien commit (`fc51151`) ;
   - **les tables ajoutées sont inertes** : l'ancien code les ignore ;
   - **retour arrière complet du schéma, à la main** : `server/rollback/035_…`, `034_…`, `033_…`, `032_…` puis `031_…`.

## 2. Retrouver la famille et le profil, puis attribuer le droit (après accord)

Dans le conteneur de production (`railway ssh`, dossier `/app/server`) :

1. **Recherche** : `node dist/admin-cli.js platform-find <votre e-mail> --name adil`.
   - L'e-mail est comparé côté serveur, sans tenir compte des majuscules. Il n'est jamais affiché ni enregistré dans un journal.
   - La sortie liste la famille (identifiant interne) et ses profils. Elle marque celui qui porte l'e-mail (« porte cet e-mail »)
     et ceux qui correspondent au prénom (« ← correspond au prénom »).
   - Une commande d'attribution n'est **proposée** que si une seule famille porte l'e-mail et qu'un seul profil actif s'appelle
     Adil.
   - Si l'e-mail est porté par un autre membre, la sortie le dit et ce membre **ne reçoit pas** le droit.
   - Si plusieurs profils ou plusieurs familles correspondent : **aucune commande proposée**. Copiez la sortie (identifiants
     internes, prénoms, rôles) et c'est vous qui tranchez.
2. **Simulation** : `node dist/admin-cli.js platform-grant <profil> --family <famille>`. Elle affiche le prénom, le rôle et la
   famille du profil visé, sans rien écrire.
3. **Attribution** : la même commande avec `--execute`. Elle est journalisée (`platform_admins_history`).
4. **Contrôle** : `node dist/admin-cli.js platform-status` doit lister ce seul profil.
5. **Retrait à tout moment** : `node dist/admin-cli.js platform-revoke <profil> --execute`. L'effet est immédiat sur toutes les
   routes.
6. **Familles de démonstration ou de vérification** (par exemple la famille de vérification Google) :
   `node dist/admin-cli.js platform-exclude <identifiant famille> --reason verification --execute`.

## 3. Bundle Android de production (import par le propriétaire, après le serveur)

- Le workflow « Android — bundle de PRODUCTION » produit une pré-version GitHub. Il n'y a aucun envoi sur Google Play.
  - Code de version : supérieur à toutes les versions produites, donc **1198 ou plus**. La **1197** reste la version de test des
    achats (serveur de recette), réservée au test interne.
  - Le serveur de production est le seul présent dans le code (contrôlé) : l'adresse de recette, le tunnel et l'adresse de
    l'émulateur en sont absents.
- **Import** : *Play Console › Tester et publier › Production › Créer une version*, importer `MesCourses-1.1.0.aab`, puis examiner
  et déployer, de préférence en déploiement progressif.
- **Rien ne s'active** avec cette version :
  - quota désactivé, achats fermés et aucune offre affichée ;
  - mise à jour obligatoire désactivée ;
  - entrée « Espace plateforme » visible seulement pour le profil autorisé à l'étape 2.
- **Ordre et compatibilité** :
  - La version 1196 continue de fonctionner avec le nouveau serveur.
  - La nouvelle version fonctionne aussi avec l'ancien serveur, mais sans l'espace plateforme. Publier après le serveur évite cet
    état intermédiaire.
- **Data safety Play Console** : l'application déclare la permission d'achat Google Play (bibliothèque de paiement incluse). Aucun
  achat n'est possible tant que les produits ne sont pas créés et que les achats restent fermés sur le serveur.
