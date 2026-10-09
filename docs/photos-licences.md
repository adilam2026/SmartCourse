# Photos du catalogue — sources, licences, procédure

État au 9 octobre 2026 : **aucune photo définitive n'est importée. Les photos restent indispensables à la V1 et ce point est toujours bloquant.**
Nouveau contrôle le 9 octobre 2026 : `commons.wikimedia.org`, `upload.wikimedia.org`, `world.openfoodfacts.org` et `images.openfoodfacts.org` sont **toujours refusés** (403 de la politique d'accès sortant), comme le dépôt Debian et celui de PostgreSQL. L'environnement de développement bloque l'accès réseau aux sources d'images (Wikimedia Commons, Open Food Facts : refus 403 de la politique d'accès sortant). Rien n'a donc été téléchargé ni vérifié en ligne. Tout ce qui suit sur les licences vient de ma connaissance générale et **doit être relu sur les pages officielles au moment de l'import**.

## Ce qui est déjà en place (testé)

- Stockage : chaque photo est normalisée (carré 480 × 480, WebP, environ 30 Ko), nommée par son empreinte SHA-256, **immuable** (la base interdit `UPDATE`/`DELETE` sur `photo_assets`). Changer une photo = en créer une nouvelle ; les archives gardent l'ancienne.
- Provenance : chaque photo enregistre source, URL d'origine, licence, URL de licence, auteur, texte d'attribution.
- Contrôle automatique à l'import (`npm run photos -- import manifeste.json`) :
  - acceptées : domaine public, CC0, CC BY 1.0–4.0, CC BY-SA 1.0–4.0, Pexels / Pixabay / Unsplash, photo familiale ;
  - refusées : tout NC (usage non commercial), tout ND (pas de dérivés, or on recadre), licence inconnue, « tous droits réservés » ;
  - URL d'origine obligatoire (sauf photo familiale) ; auteur obligatoire pour CC BY / CC BY-SA ;
  - le manifeste est validé en entier **avant** la première écriture : une entrée refusée n'importe rien.
- Affichage : écran « Crédits photos » alimenté par `GET /api/credits` (auteur, source, licence).
- L'affichage ne dépend jamais d'un lien externe : les images sont copiées dans notre stockage.

## Sources envisagées (à vérifier à l'import)

| Source | Pour quoi | Points à vérifier |
|---|---|---|
| Wikimedia Commons | produits frais (légumes, fruits) | licence **par fichier** (CC0, CC BY, CC BY-SA, domaine public) ; auteur et lien de la page ; ne retenir que les fichiers dont les métadonnées (`extmetadata`) donnent licence et auteur |
| Open Food Facts | produits emballés avec marque (code-barres) | les images de produits sont publiées sous une licence CC BY-SA, d'après ma connaissance ; à confirmer sur leur page « Termes et conditions » ; vérifier que les emballages reproduits ne posent pas de problème de marque |
| Pexels / Pixabay / Unsplash | ambiances, produits génériques | licences gratuites mais avec des restrictions (pas de revente de la photo seule, pas d'usage suggérant l'aval d'une marque) ; relire les conditions en vigueur |
| Photos de la famille | tout produit introuvable ou mal illustré | aucune question de licence ; fonction déjà disponible pour l'administrateur (`POST /api/products/:id/photo`) |
| Images d'un site marchand | — | **non retenues par défaut** : droits d'auteur, conditions d'utilisation interdisant souvent la copie ; à ne faire que si le marchand fournit explicitement une licence ou une API autorisant la réutilisation |

## Ouvrir l'accès réseau (à faire par vous, une seule fois)

Je ne peux pas modifier ces réglages : ils sont dans l'environnement qui héberge cette session. Les libellés exacts peuvent légèrement différer de ce qui suit, car je ne vois pas votre écran ; le principe est celui de la documentation ([Network access](https://code.claude.com/docs/en/cloud-environments#network-access)).

1. Dans l'application Claude, ouvrez cette session. Dans **la barre de titre de la session**, cliquez sur **le nom de l'environnement cloud** (le menu de l'environnement).
2. Cliquez sur **Edit** (Modifier).
3. Cherchez le réglage **Network access** (Accès réseau).
   - Si le niveau est **Limited** (Limité) : une zone **Allowed domains** (Domaines autorisés) apparaît.
   - Si l'écran affiche **Custom** (Personnalisé) : la même zone existe, avec une case pour inclure la liste par défaut des gestionnaires de paquets.
4. Dans **Allowed domains**, saisissez ces cinq domaines, **un par ligne** (ou séparés comme le champ l'indique), sans `https://` :

   ```
   commons.wikimedia.org
   upload.wikimedia.org
   world.openfoodfacts.org
   images.openfoodfacts.org
   static.openfoodfacts.org
   ```
5. **Laissez cochée** la case **Allow package managers** (ou « inclure la liste par défaut des gestionnaires de paquets ») : sans elle, l'installation des dépendances du projet serait bloquée.
6. Enregistrez (**Save**).
7. Écrivez-moi « domaines ouverts ». Je teste l'accès. Si les domaines sont encore refusés, le changement ne s'applique peut-être qu'aux **nouvelles sessions** : ouvrez une nouvelle session sur la **même branche** `claude/family-shopping-list-specs-eqevg8` (tout est déjà poussé) et écrivez-y « reprends les photos ».

Ne choisissez pas un niveau d'accès plus large que nécessaire (« accès complet à Internet ») : ces cinq domaines suffisent.

## Procédure d'import, une fois le réseau ouvert (outil prêt et testé sur des réponses simulées)

1. `npm run photos:fetch -- search data/photo-queries.json staging 4` : pour chaque produit sans marque (50 produits dans `server/data/photo-queries.json`), jusqu'à 4 candidats de Wikimedia Commons ; seuls les fichiers dont **la licence est acceptée** (CC0, domaine public, CC BY, CC BY-SA), avec **auteur** pour CC BY / CC BY-SA, et d'au moins 600 px sont gardés. Licence, auteur et page d'origine viennent des métadonnées de chaque fichier.
2. `npm run photos:fetch -- sheet staging` : planches (5 produits × 4 candidats) que je regarde une par une pour choisir : le produit doit être **reconnaissable à l'écran d'un téléphone**, au premier plan, sans marque ni texte visible, sans personne.
3. `npm run photos:fetch -- manifest staging selection.json manifest.json`, puis `npm run photos -- import manifest.json` : normalisation (carré 480 px, WebP), contrôle de licence, copie dans notre stockage, enregistrement de la provenance. L'écran « Crédits photos » liste automatiquement les auteurs.
4. Je vous montre le résultat sur les captures de l'application avant de passer aux produits emballés.

Limite à connaître : le premier lot (produits frais et sans marque) dépend de la qualité des photos disponibles sur Commons. Pour quelques produits (levure chimique, lingettes, sacs-poubelle…), il peut n'y avoir aucune photo libre de bonne qualité ; je vous les listerai plutôt que d'en importer une médiocre.

## Foyer au Maroc : produits emballés

Pour les produits de marque marocaine, je ne compte pas sur Wikimedia Commons (peu d'emballages) ni sur une couverture suffisante d'Open Food Facts (non vérifiée). **La voie la plus sûre : vos propres photos** de vos paquets habituels, avec le bouton 📷 de Réglages → Catalogue. Voir `marques-a-valider.md`.

## Interface sans photo

Aujourd'hui, un produit sans photo affiche un emoji de sa **catégorie** : tous les produits d'une même catégorie ont donc le même emoji. **Cela ne permet pas au personnel de distinguer les produits sans lire**, et je ne le considère pas comme acceptable pour la recette : c'est un état provisoire, pas une solution. Je n'ai pas inventé d'emojis par produit : plusieurs produits n'en ont pas de fidèle (courgettes, persil/coriandre/menthe, semoule/farine…), et un emoji faux est pire qu'aucun.

Tant qu'un produit n'a pas de photo, l'interface affichera une tuile neutre avec le nom du produit en grand (pas de fausse photo). La recette de l'interface personnel nécessite toutes les photos.
