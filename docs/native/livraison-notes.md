**Recette uniquement — hors production, ne pas distribuer, aucune publication Google Play.**

APK de l'application Android native, lots 1 à 6. Identifiant `app.smartcourse.courses.nativeproto` (s'installe à côté de l'application actuelle). Même signature de recette que les versions précédentes : s'installe par-dessus sans désinstaller.

Résultats réels (run 39, émulateur Android 14, serveur de recette jetable) : lot 1 28/28, lot 2 58/58, lots 3 à 6 77/77, 0 plantage ; tests ciblés M, M2, K9, R, RW, I verts (run 38).

Défauts et limites connus : notifications périodiques (environ 15 min, non instantanées) — solution définitive non décidée ; application d'une proposition de prix de la ville non testée de bout en bout (il faut plusieurs familles) ; aucun essai sur téléphone réel, TalkBack, mode sombre ni grandes polices.

## Corrections : aucune liste en cours, achetés en bas, déconnexion visible
- « Aucune liste en cours » + « Créer une liste » (ouvre la sélection ; rien n'est créé en consultant l'écran) ; menu à trois points masqué sans action utile ; liste clôturée ailleurs : écran actualisé en direct.
- Liste active vide : « La liste est vide » + « Ajouter des articles ».
- Articles cochés dans « Déjà achetés », après toutes les catégories (admin et personnel) ; décochés, ils reprennent leur place.
- « Se déconnecter » en bas de Réglages (distinct de « Réinitialiser la famille ») et dans Compte ; avertissement si des modifications ne sont pas encore envoyées.
- Tests ciblés L et D : 42/42 (run 43), captures dans docs/native/e2e-cible/.
