# Matrice des fonctions — application native (avant livraison de recette)

Légende : **R** réel et vérifié de bout en bout sur émulateur contre le serveur de recette · **P** partiel (précisé) · **N** absent.
Identifiants de contrôle : `e2e-lot2/resultats.txt` (A…E), `e2e-lot3/resultats.txt` (G…V), tests ciblés (M, M2, K9, R, RW, I).

| Fonction | État | Preuves | Manque ou limite |
|---|---|---|---|
| Catalogue : ajouter | R | lot 2 E10–E11 (réactivation plutôt que recréation) | — |
| Catalogue : retirer (réversible, « Annuler ») | R | lot 2 E5–E9 | — |
| Catalogue : compteurs, recherche, catégories, pages | R | lot 2 E1–E4, E12 | — |
| Profils : créer, modifier, rôle, code d'accès | R | lot 2 C1–C11 | — |
| Profils : désactiver / réactiver (sessions coupées par le serveur) | R | lot 2 C12–C15 | — |
| Profils : supprimer (anonymisé, achats conservés) | R | lot 2 C18–C19, A9–A11 | — |
| Profils : protections (principal, dernier administrateur) | R | lot 2 A1–A8, C16–C17 | — |
| Ville du profil | R | lot 2 D1–D6 | — |
| Liste : sélection, quantités, achat, correction, clôture | R | lot 3 G–J | — |
| Hors connexion, envoi unique, liste terminée → « Reprendre » (articles et quantités) | R | lot 3 L–M, ciblés M et M2 | Liste **supprimée** pendant l'attente : test unitaire seulement |
| Brouillons par profil | R | lot 3 H4, N | — |
| Mise à jour en direct | R | lot 3 S1 | — |
| Prix : saisie, affichage, total estimé | R | lot 3 O1–O7 | — |
| Prix : rétablir le prix initial | R | lot 3 O9 | — |
| Prix : partage avec la ville | R | lot 3 O8 (contribution enregistrée) | — |
| Prix : synchronisation par ville | P | lot 3 O10 (fenêtre, « aucune proposition ») | L'application d'une proposition n'est pas testée de bout en bout : il faut plusieurs familles contributrices |
| Favoris : enregistrer, utiliser, supprimer | R | lot 3 T1–T4 | — |
| Historique : liste, détail, Recommander | R | lot 3 I7, J1–J4 | — |
| Historique : suppression d'une commande | R | lot 3 U1 | — |
| Partage du texte de la liste | R | lot 3 V1 (fenêtre de partage Android) | Contenu partagé vérifié par lecture du code, pas par le test |
| Statistiques | R | lot 3 P1–P2 | — |
| Récupération, Sauvegarde, À propos | R | lot 3 Q1–Q4 | Lien de récupération reçu par e-mail : ouvert dans le navigateur (non testé ici) |
| Réinitialiser la famille (jamais confirmée en test) | R | ciblé K9 (clavier, défilement, confirmation) | Effacement réel non exécuté volontairement |
| Création de famille par lien d'installation | R | ciblé I (aucun jeton à saisir ; requête reçue, refus 403 du serveur) | Création réussie non testée : le jeton du serveur de recette est déjà consommé |
| Notifications : permission, tâche, notification reçue | R | ciblés R et RW | **Mode périodique non accepté comme solution définitive** (décision en attente) ; délai d'Android (~15 min) non observé en test |
