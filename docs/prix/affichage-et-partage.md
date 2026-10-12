# Prix indicatifs, favoris et recommandation

## Trois modes d'affichage (par profil, désactivés par défaut)
Réglages → Prix (administrateurs) ou profil → « Affichage des prix » (tous les profils, personnel compris). Choix propres au profil, synchronisés sur ses appareils ; les prix du catalogue et les quantités des listes sont communs à la famille.
- **Simple** (défaut) : aucune trace de prix ; fonctionnement actuel des quantités.
- **Prix indicatifs** : « 9,90 DH / kg », « 14,00 DH / paquet de 250 g ». Aucun montant.
- **Prix et total** : quantité × prix = montant par article, total estimé, quart de kilo ou de litre (boutons ±0,25 et saisie libre ; pièces, pots, boîtes, paquets : entiers). Activer les montants active les prix.
Changer de mode ne modifie jamais une quantité.

## Prix de la famille et commandes
Un administrateur règle le prix d'un produit (Catalogue → Modifier). Le prix de référence est **figé sur la ligne à la validation** ; une commande archivée garde le sien ; réévaluer une liste en cours est une action explicite (`POST /api/lists/:id/reprice`). Le total est une **estimation**, jamais une dépense payée (les statistiques n'utilisent aucun prix).

## Favoris et Recommander
Favoris (page Liste) : les administrateurs créent, nomment, modifient, suppriment ; « Utiliser cette liste » prépare une liste modifiable avant validation (rien n'est enregistré avant « Valider », le favori n'est jamais modifié). Liste en cours : « Ajouter à la liste actuelle » (pas de doublon, quantités additionnées seulement pour des unités identiques) ou « Remplacer son contenu » (confirmation). Produits désactivés signalés, jamais réactivés. « Recommander » (détail d'une commande passée) fonctionne de même, achats réinitialisés, ancienne commande intacte, prix actuels.

## Partage communautaire
« Partager ce prix » (administrateur) : produit du catalogue partagé, prix, unité/conditionnement, date, ville et magasin facultatifs ; jamais de nom, e-mail, code famille ni historique. Limites : 10 partages par jour, 1 par produit et par jour, valeurs incohérentes refusées (au-delà de 4× la référence). « Synchroniser les prix » : proposition = **médiane** d'un format (au kg, au litre, ou par unité avec son conditionnement), d'au moins **3 familles différentes**, valeurs aberrantes (×3) ignorées, formats jamais mélangés ; l'administrateur applique chaque prix (confirmation s'il remplace un prix de la famille) ou le signale (masqué pour sa famille ; 3 familles qui signalent l'écartent).
