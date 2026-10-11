# Interface : système visuel commun

Direction validée sur maquette (liste des parents, catalogue du personnel, statistiques), déclinée sur tous les écrans. Source : `web/src/styles.css` (variables en tête), icônes `web/src/components/Icon.tsx`, en-tête `PageHead.tsx`.

## Principes
- **Couleurs** : fond chaud `#FBF7F0`, cartes blanches, vert profond `#17613F` (principal). **L'orange est réservé aux modifications en attente** (état « N modifications à valider », cartes « À valider », compteurs non validés). Rouge pour les erreurs et sauvegardes en défaut ; gris-bleu pour hors connexion / achats.
- **Forme** : bordures fines, ombres discrètes, rayons 12 / 18 px, hiérarchie titre (1,65 rem) › section › texte secondaire. Mode sombre pris en charge.
- **Taille du texte** : tout est en `rem` ; le texte agrandi du téléphone agrandit l'interface. Zones tactiles ≥ 48 px (contrôlé par mesure). Quand le texte est très agrandi : cartes sur une colonne, compteur `[−] [+]` sous la valeur (requêtes de conteneur en `rem`).
- **Icônes** : un seul jeu de pictogrammes (traits 2 px) avec libellé dans la navigation et les boutons ; plus d'émojis pour l'interface. Les **photos des produits** (80 visuels) et les **repères de catégories** sont conservés.
- **Composants** : `.btn` (principal, secondaire, ghost, danger), `.panel`, `.seg`, `.row`, `.hcard`, `.menuitem`, `.sheet` (fenêtres), `.banner`, `.actionbar` (barre fixe), `.qty` (compteur), champs 48 px.

## Écrans
- **Liste des parents** : « Les courses du jour », date, progression « 2 produits sur 5 achetés », **Ajouter / modifier** (principal) et **Clôturer** (avec confirmation), « Validations (N) » en action secondaire, lignes par catégorie (photo, nom, quantité+unité, auteur et heure, bouton **✓ Acheté** avec libellé), achetés atténués mais lisibles. Navigation du bas : Liste, Historique, Statistiques, Réglages (icônes + libellés), le contenu n'est jamais masqué.
- **Catalogue** : « Préparer les courses », une seule ligne d'état, onglets Tous les produits / Par catégories, recherche, grandes photos sur deux colonnes, compteur sous le nom (jamais sur la photo), étiquettes « Dans la liste » / « À valider » (pas seulement la couleur), **barre fixe « Valider N modifications »** qui s'efface quand le clavier est ouvert, jamais devant les dernières cartes.
- **Statistiques** : « Vos achats », mois (choix direct au toucher), deux cartes de synthèse (achats, produits distincts), « Les plus achetés » avec barres sur **une même mesure (nombre d'achats)**, bouton **Filtres** (période, catégorie, tri) avec filtres actifs visibles et réinitialisables, recherche, fiche produit et graphiques conservés.
- **Historique** : cartes avec date **et heure** de clôture, résumé, miniatures ; détail final par catégorie ; aucune mention de correction.
- **Réglages** (administrateur) : rubriques Famille et profils, Catalogue, Notifications, Sauvegardes (état simple, détails techniques au toucher), À propos et version.
- **Profil** : notifications, crédits photos, déconnexion ; version en section secondaire.
- **Connexion / première installation / famille créée** : même style avec la nouvelle icône.

## Contrôles automatiques (`e2e/tests/refonte.spec.ts`)
À 360, 390 et 412 px : aucun défilement horizontal, aucune zone tactile < 48 px, aucun texte coupé (noms longs, unités), contenu non masqué par la navigation, barre « Valider » entière, clavier ouvert, texte agrandi à 150 %. Captures réelles dans `docs/captures/refonte/`.
