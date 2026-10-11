# Pack d'images pour Codex

- **Manifeste** : `manifeste-images.json` (163 entrées) ou `.csv`. Une image par entrée ; **clé et nom de fichier sont définitifs**.
- **Fichier attendu** : `files/<clé>.webp` (ex. `files/papier-cuisson.webp`). Clé = identifiant stable ; on n'associe jamais une image par position ni par catégorie.
- **Format** : WebP 512×512, fond blanc ou très clair, produit entier et reconnaissable, centré avec marge, sans marque ni texte publicitaire, même style que les 80 photos existantes (planches `planches/`). Une seule variante de produit par image, exactement celle de la `description`.
- **À livrer** : un dossier `files/` (163 WebP) + le manifeste inchangé. L'intégration calcule les empreintes, vérifie que chaque nom correspond à la clé, refuse l'ensemble au moindre écart, puis relie les images (relançable sans doublon).
- **Contrôle** : planche de contrôle (nom exact sous chaque image) régénérée avec `scripts/contact-sheet.py` avant toute mise en ligne.
