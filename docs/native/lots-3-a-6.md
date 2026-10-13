# Lots 3 à 6 — listes, hors connexion, prix et réglages (APK de recette)

Présentation validée conservée (mêmes écrans, aucune page web). Branche `claude/android-native`, aucun déploiement, aucune publication, aucune donnée réelle : tout a été vérifié contre un serveur de recette jetable (Docker + PostgreSQL) lancé par la CI. L'application actuelle n'est pas remplacée (identifiant `app.smartcourse.courses.nativeproto`, nom « Courses (natif) »).

## Ce qui est opérationnel (réel)
### Lot 3 — listes, sélection, quantités, achats
- **Liste du jour** (administrateur, parent, personnel) lue sur le serveur ; date réelle ; progression ; total estimé si activé.
- **Sélection** (3 modes validés) sur le catalogue réel de la famille, avec vraies photos ; « Terminer ma sélection » envoie **un seul lot** d'opérations numérotées (ajout, ou mise à jour de la quantité si l'article est déjà sur la liste, ou nouvelle demande s'il a déjà été acheté).
- **Quantités** : unités du serveur (kg, litre, pièce, paquet, bouteille, brique, pot, boîte), conversions exactes g↔kg et ml↔L ; quantité modifiable depuis la liste (administrateur / parent : toucher la ligne ; personnel : boutons ± et poubelle, avec regroupement des appuis rapides).
- **Achats** : cocher / décocher = achat / correction (parents et administrateurs). Refus du serveur pour le personnel vérifié par requête directe (403). « Acheté par … · heure » affiché.
- **Terminer / clôturer** la liste, **créer** une liste, **partager** le texte de la liste, **Favoris** (utiliser ; enregistrer la liste en cours ou supprimer : administrateur), **Recommander** depuis l'historique.

### Lot 4 — stockage local, brouillons, hors connexion
- Copie locale (fichiers écrits de façon atomique) de la dernière liste, du catalogue, des préférences d'affichage — rangée **par famille + profil** : un autre profil sur le même téléphone ne voit rien.
- **Brouillon de sélection** par famille + profil + liste (clé « aucune liste » quand il n'y en a pas) ; survit à la fermeture brutale de l'application.
- **« Envoi en attente »** : hors connexion, le lot est gardé sur le téléphone avec ses identifiants ; renvoyé tel quel au retour du réseau (reconnexion détectée, relance toutes les 20 s, flux SSE) ; le serveur rejoue la même réponse en cas de double envoi → **jamais deux fois**.
- **Liste terminée ou supprimée entre-temps** : rien n'est ajouté à l'archive, la liste supprimée n'est jamais recréée ; les articles demandés sont gardés et proposés par **« Reprendre »**.
- Achats, corrections et clôture exigent le réseau (message clair sinon) — même règle que le site.
- **Mise à jour en direct** : flux SSE du serveur (liste, catalogue, préférences) avec reconnexion progressive.

### Lot 5 — prix, historique, favoris, statistiques
- Calcul décimal exact des prix : port Kotlin de `pricing.ts` vérifié par **255 cas générés à partir du code TypeScript** lui-même (montants, arrondis, conversions kg↔pièce, formats « 14,00 DH / paquet de 250 g »).
- **Affichage** : prix indicatifs et total estimé enregistrés sur le serveur pour le profil (désactivés par défaut) ; mode de sélection préféré conservé.
- **Gestion des prix** (administrateur) : prix réels de la famille ou de référence, filtre « Sans prix », saisie (montant, quantité de référence, unité, contenu), « Rétablir le prix initial », **partager** son prix avec sa ville, **synchroniser** les prix de la ville (propositions à choisir ; rien ne s'applique tout seul ; signaler).
- **Historique** réel (pagination), détail, **Recommander**, suppression (administrateur, confirmation).
- **Statistiques** réelles (ce mois, mois précédent, 3 mois) : achats, produits différents, par catégorie, produits les plus achetés ; comparaison seulement si l'historique la permet ; « Dépense payée : non saisie » (aucun montant inventé).

### Lot 6 — récupération, notifications, autres réglages
- **Besoin d'aide** : « J'ai oublié mon code » (administrateur principal : lien par e-mail), « Récupérer ma famille » (code famille par e-mail), aide « code famille inconnu » ; réponses neutres du serveur. Le lien reçu s'ouvre dans le navigateur.
- **Première connexion** : « Rejoindre » explique que l'administrateur crée le profil (le serveur n'a pas d'inscription libre) ; « Créer ma famille » appelle la vraie installation (jeton d'installation exigé, e-mail de vérification) sans ouvrir de session avant la vérification.
- **Récupération** (réglage) : adresse, état « vérifiée », renvoi du lien (délai affiché), e-mail de test.
- **Notifications** : permission Android demandée à l'activation, canal « Demandes de la famille », vérification périodique (WorkManager) + à chaque ouverture ; notification « Nouvelle demande » (prénom et nombre seulement).
- **Sauvegarde** (lecture seule) : état réel des sauvegardes du serveur. **À propos** : version, serveur, profil, confidentialité, suppression du compte (pages web du serveur). **Réinitialiser la famille** : aperçu des données effacées, mot de passe + code famille, confirmation (administrateur principal).

## Écrans « Hors du périmètre visuel » conçus dans la charte (à valider)
Récupération · Notifications · Sauvegarde · À propos · Réinitialiser la famille · Aide à la connexion · Création de famille · Favoris : captures du prototype (`captures/V13…V16`) et de l'application réelle (`e2e-lot3/lot3-*.png`). Votre validation ne couvre que les écrans livrés ici.

## Limites et points à savoir (honnêtes)
- **Notifications non instantanées** : le serveur est sur Railway seul (pas de service Google/FCM). Android lance la vérification environ toutes les 15 minutes (moment non garanti, économie d'énergie) et à chaque ouverture. Sans autorisation Android, aucune notification.
- Les **statistiques** n'affichent aucune dépense (aucun montant payé n'est jamais saisi) ; la comparaison peut être absente faute d'historique.
- « Rejoindre une famille » n'est pas une inscription : le serveur n'offre que la création par l'administrateur.
- Cas « liste **supprimée** pendant l'attente » : couvert par un test unitaire (réponse 404 → articles gardés), pas par le parcours sur émulateur (la suppression exige une liste archivée).
- Non vérifié : téléphone réel, TalkBack, grandes polices, mode sombre, tablette, rotation, Android < 14, notification après redémarrage du téléphone, très longue coupure réseau (> 30 jours : l'heure du téléphone n'est alors plus crue par le serveur).
- Le défaut d'activation des notifications signalé sur le site doit encore être diagnostiqué **sur un téléphone** ; l'application native utilise un mécanisme différent.
- Le serveur n'a reçu qu'une modification (lot 2, catalogue complet). Aucun changement de serveur dans ces lots.
