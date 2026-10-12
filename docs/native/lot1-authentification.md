# Lot 1 — Authentification (APK de recette `native-proto-9`)

## Opérationnel (réel, testé sur émulateur contre un serveur de recette isolé)
- Saisie et test de l'adresse du serveur (`GET /health`), refus d'une adresse qui n'est pas un serveur Courses, HTTPS obligatoire (sauf émulateur).
- Connexion (`POST /api/auth/login`), puis lecture du profil complet (`GET /api/me`) : nom, rôle réel, famille, ville.
- Session conservée (cookie `sc_session`, stockage chiffré AES-256 dans le Keystore Android) ; le code d'accès n'est jamais enregistré.
- Réouverture directe sur l'application ; vérification auprès du serveur à chaque retour au premier plan.
- Serveur injoignable : l'application reste ouverte avec « Hors connexion : session conservée ».
- Session révoquée, profil désactivé, mauvais code : retour à la connexion avec message explicite.
- Déconnexion : fermeture locale immédiate + révocation côté serveur (rejouée plus tard si le réseau manque).
- Messages d'erreur distincts : identifiants, trop de tentatives, installation inachevée, réseau, délai dépassé, certificat, adresse non sécurisée, serveur en panne, serveur inconnu.
- Présentation selon le rôle réel : administrateur / parent (sans Réglages) → présentation compacte ; personnel → confortable.
- Zones tactiles du personnel ≥ 48 dp (audit automatique sur l'émulateur : 18 écrans, 0 écart).
- Icône Courses (adaptative, monochrome, démarrage) ; signature de recette stable.

## Simulé (données fictives, aucun serveur contacté)
Listes, sélection, quantités, historique, catalogue, prix, statistiques, profils, affichage (écrans V02 à V12) ; « Première connexion » (rejoindre / créer une famille) ; Récupération / « Besoin d'aide » ; Notifications, Sauvegarde, À propos. Le bandeau indique « RECETTE · connexion réelle · listes simulées ».

## Tests
- 17 tests unitaires (client HTTP, session, erreurs) — `testDebugUnitTest`.
- 28 contrôles de bout en bout sur émulateur Android 14 contre un serveur Docker + PostgreSQL jetable (`docs/native/e2e/`).
- Audit des zones tactiles du personnel (`docs/native/captures/controles.txt`).

## Limites connues
- Aucun essai sur téléphone réel.
- Masques d'icône : seul le masque rond de l'émulateur est capturé ; carré arrondi calculé (`docs/native/icone/apercu-masques.png`). Icônes thématiques non vérifiées sur le lanceur.
- Déconnexion hors connexion : la session reste valide côté serveur tant que la révocation n'a pas pu être envoyée (durée de vie : 90 jours glissants).
