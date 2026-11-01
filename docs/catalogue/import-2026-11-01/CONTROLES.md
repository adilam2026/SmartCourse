# Contrôles effectués

- 89 captures sources présentes, empreintes SHA-256 vérifiées.
- 81 fichiers WebP, tous décodables en 512×512 ; 81 empreintes distinctes et conformes au manifeste.
- Manifeste : aucune clé en double ; correspondances des 81 articles contrôlées.
- Tri : trois tests unitaires passent (voisinage après réactivation, visibilité/ordre d’arrivée, accents et égalités).
- Compilation TypeScript du serveur : réussie.
- Tri SQL : ordre vérifié dans PostgreSQL embarqué, cohérent avec le tri du catalogue familial.
- Script SQL d’ajout : exécuté deux fois sur un schéma représentatif PostgreSQL embarqué ; idempotence, identifiants existants et catégories personnalisées conservés. 45 ajouts, 36 références existantes réutilisées.
- Patch : vérifié contre le commit préparé e439402 (base 4862be3984ac4944e7464cb7112427ee6fa81e1e).

Ces contrôles ne remplacent pas une recette sur le serveur de livraison et les téléphones. Aucun déploiement, import en production ni reconstruction Android n’a été effectué. Les petits détails des étiquettes retouchées par IA ne sont pas certifiés identiques aux originaux. Les prix sont des relevés conservés, sans import automatique faute de date de prise de vue confirmée.
