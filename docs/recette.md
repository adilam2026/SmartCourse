# Recette : critères du cahier des charges ↔ tests automatisés

Trois niveaux de tests : serveur (vrai PostgreSQL, courses de concurrence), moteur de synchronisation du téléphone (IndexedDB simulée, faux serveur), parcours complets dans un navigateur Chromium réel (mobile, serveur réel, PostgreSQL réel, service worker, mode hors connexion). Résultat des dernières exécutions : voir la fin de ce fichier.

| # | Critère | Tests |
|---|---|---|
| 1 | Le personnel retrouve immédiatement le catalogue de la liste active | E2E `staff` « critère 1 » ; moteur « critère 1 » |
| 2 | Cocher puis décocher laisse « Valider » grisé | logique « critère 2 » ; moteur « critère 2 » ; E2E « critères 2, 3, 4 » |
| 3 | Fermer puis rouvrir conserve les choix non validés | moteur « critère 3 » ; E2E « critères 2, 3, 4 » (rechargement de la page) |
| 4 | Valider rend la sélection visible chez les parents | serveur « critère 4 » ; E2E « critères 2, 3, 4 » ; E2E temps réel « critère 4/6 » (sans rechargement) |
| 5 | Deux membres ajoutant le même produit : une seule ligne | serveur « critère 5 » (5 appels simultanés) |
| 6 | Achat d'Adil visible chez Lamiaa avec son nom | serveur « critère 6 » ; E2E parent « critère 6 » ; E2E temps réel |
| 7 | Le personnel ne peut pas retirer un article acheté, même depuis un ancien brouillon | serveur « critère 7 » ; logique « critère 7 » ; moteur « critère 7 » ; E2E staff « critère 7 » |
| 8 | Correction sans motif, tracée | serveur « critère 8 » + « motif conservé » ; E2E parent « critère 8 » |
| 9 | Un ajout n'écrase pas la modification indépendante d'un autre | serveur « critère 9 » ; moteur SSE « critère 9 / 10 » |
| 10 | Interruption réseau : modifications conservées, état réel affiché | moteur « critère 10 » (même `opId` à la reprise) ; E2E staff « critère 10 » ; E2E parent hors connexion |
| 11 | Liste clôturée avec restants : articles conservés non achetés | serveur « critère 11 » ; E2E parent « critère 11 » |
| 12 | Un ancien brouillon ne modifie jamais une liste archivée | serveur « critère 12 » (+ refus par déclencheurs SQL) ; moteur « critère 12 » ; E2E staff « critère 12 » |
| 13 | Un profil désactivé n'accède plus aux données | serveur (désactivation, flux SSE coupé, révocation hors application) ; E2E staff « critère 13 » ; E2E temps réel « critère 13 » |
| 14 | Une famille ne voit pas les données d'une autre | serveur auth/catalogue/listes « critère 14 » (profils, produits, photos, listes, achats, corrections) |
| 15 | Une référence garde identité et historique malgré renommage / changement de photo | serveur « critère 15 » (archives figées) ; catalogue « renommer… conserve l'identité » |

## Exigences hors des 15 critères, aussi couvertes

- Jeton d'installation consommé atomiquement (6 appels simultanés → 1 création) ; dernier administrateur protégé (y compris deux désactivations simultanées).
- Verrous : tests déterministes (une opération attend une clôture en cours ; la clôture attend les opérations en cours ; articles différents non bloquants) et courses répétées achat/retrait, achat/achat, correction/achat, clôture/modifications. Les verrous sur l'article ont été vérifiés par mutation (leur retrait fait échouer les tests).
- Correction ciblant un achat d'une autre famille ou d'une autre liste : refusée.
- Sauvegarde : chiffrement, altération détectée, manifeste cohérent avec le dump pendant des écritures, restauration vérifiée, invariants, rétention, aucun effacement après une vérification en échec.
- Licences photo : NC/ND/inconnues refusées, provenance obligatoire, photos immuables.

## Ce qui n'est pas couvert

- **Photos définitives** : non fournies (réseau bloqué, voir `photos-licences.md`). La recette de l'interface du personnel avec de vraies photos reste à faire.
- **Marques** : en attente de votre choix (`marques-a-valider.md`).
- **Déploiement Railway** : non exécuté ici (le build Docker, lui, a été exécuté, voir `deploiement.md`).
- **iPhone / Safari réels** : testé uniquement sous Chromium mobile ; le comportement de stockage d'iOS (voir revue technique §7) est à vérifier sur un vrai appareil.

## Dernières exécutions (9 octobre 2026, après les corrections)

- Serveur (PostgreSQL 16 réel + émulateur S3) : 91 tests, 2 exécutions consécutives identiques.
- Moteur de synchronisation (IndexedDB simulée) : 32 tests.
- Parcours navigateur (Chromium mobile, serveur et base réels) : 26 scénarios, dont « Valider » sur 4 tailles d'écran.
- Compilation TypeScript stricte du serveur et de la PWA : sans erreur.
- Image Docker complète construite et exécutée ; sauvegarde + restauration vérifiée contre PostgreSQL 16, 17 et 18 (voir `deploiement.md`).

## Ajouts de cette série de corrections

- **Bouton « Valider »** : sur 320×568, 360×640, 390×844 et 412×915, avec tous les bandeaux (hors connexion, en attente, reprise, message), le bouton est entièrement dans l'écran avec marge, rien ne le recouvre (test de hit-test aux quatre coins et au centre), un vrai clic passe, et l'en-tête collant reste sous 50 % de la hauteur. Avant correction : jusqu'à 70 % de la hauteur sur 360×640 (catalogue presque inutilisable).
- **Sauvegardes** : client `pg_dump` de même version majeure que le serveur, choisi automatiquement ; stockage refusé s'il n'est pas sûr en production ; état affiché dans Réglages.
