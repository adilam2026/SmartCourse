# Lot catalogue — 89 captures

## Décisions appliquées à la préparation
- Noms génériques ; emballages de marque conservés dans les illustrations.
- Une seule référence générique pour plusieurs marques/formats : lentilles, semoule fine, cheveux d'ange, lben, céréales au chocolat, etc.
- Réutiliser les catégories existantes du dépôt ; aucune sous-catégorie de navigation. Le rayon existant « Viandes et poisson » reçoit les nouvelles espèces, sans modifier les autres rayons.
- Les voisinages servent uniquement au classement. Une réactivation conserve l'identifiant et retrouve les produits similaires.
- Aucun historique, favori, prix personnel, image personnelle ou identifiant existant n'est supprimé ni réinterprété.

## Contenu final
- `webp/` : images finales 512×512, fond blanc, fichier nommé par clé stable.
- `photo-manifest.json` : import compatible avec l'importeur existant, noms attendus et SHA-256.
- `products.json` : correspondance des articles et des références photographiées.
- `references.csv` et `references.json` : relevés des 89 captures, prix affichés, prix barrés, formats et avertissements.
- `catalogue-additions.sql` : ajouts uniquement ; relançable, clés existantes conservées.
- `controle-images.html` : galerie locale ; ouvrir après décompression.
- `code/` et `integration.patch` : correction du tri et tests ciblés, plus constructeur du pack.
- `sources/` : captures originales, pour vérifier les prix et formats.

## Préparation technique
Référence de travail : dépôt adilam2026/SmartCourse, branche claude/unites-statistiques, commit 4862be3984ac4944e7464cb7112427ee6fa81e1e. Le code peut avoir évolué depuis cette référence : comparer le patch à la branche de livraison avant application.

1. Appliquer `integration.patch` à une branche de travail, résoudre les éventuels écarts et exécuter les tests.
2. Sur une base de validation ayant les migrations du dépôt, appliquer `catalogue-additions.sql` dans une transaction.
3. Depuis `server`, importer avec `node --import tsx src/photos-cli.ts import /chemin/du/lot/photo-manifest.json`.
4. Contrôler le catalogue : produits, images, identifiants ; masquer/réactiver un article ; vérifier sa proximité et l'ordre après synchronisation.
5. Valider avant de reporter les mêmes opérations sur la version de livraison.

Les commandes d'intégration ne sont pas exécutées sur le serveur par la livraison de cette archive. Le lot ne contient aucun secret.

## Prix et formats
Les montants sont transcrits des captures, sans les présenter comme des tarifs actuels. La date de prise de vue n'est pas visible ; la date de réception ne la remplace pas. Les prix ne sont donc pas importés dans `base_prices`, qui exige une date d'observation.
Les prix promotionnels et les prix barrés sont distincts. Les marques et formats concurrents restent des observations séparées d'un même article : pas de moyenne ni de sélection automatique du prix le plus bas.
Les alertes de grammage, de poids/volume et de base de prix sont conservées. Aucune conversion g ↔ mL ni pièce ↔ poids/volume n'est inventée.

## Nature des images
Illustrations préparées avec imagegen à partir des captures fournies. La marque et l'apparence des emballages sont conservées pour la reconnaissance ; la retouche peut modifier de petits détails d'étiquette. Ce ne sont pas des photographies fabricant certifiées. Le format est normalisé par le traitement d'images existant du dépôt, sans nouveau recadrage artistique.
