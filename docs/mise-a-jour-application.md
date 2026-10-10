# Mise à jour de l'application déjà installée

## Ce qui s'est passé (cause constatée, reproduite)
L'APK est une « Trusted Web Activity » : il ouvre `https://smartcourse-production-c7ce.up.railway.app/` dans Chrome. Chrome garde la page déjà chargée (l'application reprise depuis les applications récentes **n'est pas rechargée**) et le service worker de la PWA sert l'ancienne version depuis son cache jusqu'à une nouvelle navigation. Le serveur publiait bien les nouveaux écrans, mais le téléphone continuait à afficher l'ancien bundle.

Reproduction (script `e2e/upgrade-repro.mjs`, profil Chrome persistant, service worker actif, déploiement d'un nouveau serveur) :
1. ancienne version installée ;
2. déploiement de la nouvelle version : la page restée ouverte reste sur l'ancien bundle (aucune navigation) ;
3. une ré-ouverture suffit parfois, deux parfois : tout dépend du moment où le service worker a fini de récupérer la nouvelle version.
Les anciennes versions n'avaient aucun moyen de s'en apercevoir.

Autre défaut trouvé pendant l'enquête : un fichier introuvable (`/assets/…js`) recevait la page d'accueil avec un code 200 ; un service worker pouvait la ranger comme si c'était ce fichier et laisser l'application blanche. Désormais : 404.

## Ce qui est corrigé
- Chaque construction publie `/version.json` (identifiant, commit si connu, heure) et connaît son propre identifiant.
- L'application compare les deux au démarrage, au retour au premier plan, au retour du réseau et toutes les 10 minutes. Si le serveur a une version plus récente : le service worker est rafraîchi, puis la page se recharge. Elle attend si un envoi est en cours ou si une fiche est ouverte (bandeau « Une nouvelle version est disponible — Mettre à jour »), ne recharge jamais en boucle (2 essais par version, puis bouton manuel).
- **Aucune donnée perdue** : brouillons, quantités et envois hors connexion sont enregistrés dans le téléphone avant tout envoi réseau ; la mise à jour ne touche ni la session ni les données locales. Pas de désinstallation.
- Fiche du profil (tous les rôles) et Réglages (administrateur) : « Version de l'application » — version chargée sur ce téléphone, version publiée par le serveur, état, bouton « Vérifier / Mettre à jour maintenant ».
- Aucun nouvel APK : l'APK charge simplement le site.

## Pour les téléphones qui ont encore l'ancienne version
Ils n'ont pas le mécanisme ci-dessus. Une seule fois : fermer complètement l'application (la retirer des applications récentes), la rouvrir ; si les compteurs et le sélecteur n'apparaissent pas, recommencer une seconde fois. Ensuite, plus rien à faire : « Profil → Version de l'application » doit montrer la même version chargée et publiée.

## Recette de mise à jour (script)
`e2e/upgrade-acceptance.mjs` (ancien serveur + ancienne application, liste existante avec achat et brouillon, déploiement du nouveau serveur, relance, mise à jour automatique d'une page ouverte, envoi hors connexion) : 22 contrôles.
