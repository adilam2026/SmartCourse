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

## Procédure quand le réseau est ouvert

1. L'utilisateur autorise les hôtes : `commons.wikimedia.org`, `upload.wikimedia.org`, `world.openfoodfacts.org`, `images.openfoodfacts.org` (et, au besoin, la banque d'images choisie).
2. Pour chacune des 80 références, je cherche 2–3 candidates, je lis licence et auteur dans les métadonnées de la source, je télécharge, puis je produis un manifeste.
3. Revue visuelle (lisibilité sur mobile, produit correspondant vraiment au nom, pas de marque par erreur sur un produit générique).
4. Import par le CLI ; les crédits apparaissent dans l'application.
5. Les produits emballés avec marque ne sont figés qu'**après validation des marques** (voir `marques-a-valider.md`).

## Foyer au Maroc : produits emballés

Pour les produits de marque marocaine, je ne compte pas sur Wikimedia Commons (peu d'emballages) ni sur une couverture suffisante d'Open Food Facts (non vérifiée). **La voie la plus sûre : vos propres photos** de vos paquets habituels, avec le bouton 📷 de Réglages → Catalogue. Voir `marques-a-valider.md`.

## Interface sans photo

Aujourd'hui, un produit sans photo affiche un emoji de sa **catégorie** : tous les produits d'une même catégorie ont donc le même emoji. **Cela ne permet pas au personnel de distinguer les produits sans lire**, et je ne le considère pas comme acceptable pour la recette : c'est un état provisoire, pas une solution. Je n'ai pas inventé d'emojis par produit : plusieurs produits n'en ont pas de fidèle (courgettes, persil/coriandre/menthe, semoule/farine…), et un emoji faux est pire qu'aucun.

Tant qu'un produit n'a pas de photo, l'interface affichera une tuile neutre avec le nom du produit en grand (pas de fausse photo). La recette de l'interface personnel nécessite toutes les photos.
