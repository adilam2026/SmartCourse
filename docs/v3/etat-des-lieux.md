# Courses V3 — état des lieux de réalisation (audit)

> **Mise à jour du lot « régressions + parcours personnel »** : les lignes B9, D1, G11, K7 ci-dessous ont changé (voir la section « Lot 2 » en fin de document). Les autres lignes sont inchangées.

Audit de réalisation, sans nouveau développement. Rien n'est fusionné vers la production.

**Légende**
- Statut : ✅ réalisé · 🟡 partiel · ❌ non réalisé · ⚠️ régression.
- Version : **V2** = application actuellement en production (commit `a9bd9a4`, déjà déployée) · **V3** = ajouté sur la branche `claude/v3-selection` seulement (derrière l'aperçu V3).
- Rôles : **P** administrateur principal · **A** autre administrateur · **S** personnel · (Pa parent, rôle existant hors checklist, présentation large).
- Recette : la session de recette fait tourner toute la branche `claude/v3-selection` (V2 + V3) : **oui** pour tout ce qui est « réalisé » ou « partiel ».
- Preuve : `test` = fichier de `e2e/tests/` (Playwright, Chromium émulant 360/390 px, **pas un vrai téléphone**) ; captures dans `docs/captures/`.
- Aucune ligne n'a été validée sur un vrai téléphone.

## A. Deux présentations selon le rôle
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| A1 | Personnel : simple, visuel, grandes photos, boutons confortables | ✅ | V2 | Connexion personnel → « Préparer les courses » · S | `presentations` · `presentation/personnel-390.png` | — |
| A2 | Présentation compacte pour P **et** A | ✅ | V2 | Connexion administrateur · P, A | `presentations` (testé avec P) · `presentation/administrateur-liste-390.png` | Testée avec le principal ; un second administrateur a le même rôle donc la même présentation, mais sans test dédié |
| A3 | Compacte sur Liste, Historique, Statistiques, Catalogue, Réglages, fenêtres | 🟡 | V2 | Onglets Liste · Historique · Statistiques · Réglages · P, A | `presentations` · `presentation/administrateur-{liste,historique,statistiques,catalogue,reglages}-390.png` | Le panneau de quantité V3 et l'écran « Ajouter / modifier » n'ont pas de variante compacte administrateur |
| A4 | Changement de profil : présentation et droits du nouveau profil | ✅ | V2 | Déconnexion puis connexion d'un autre profil · tous | `presentations` (bascule sans rechargement), `staff`, `v3-selection` | — |
| A5 | Aucun bouton/menu/filtre coupé, aucun débordement | 🟡 | V2 | Tous les écrans · tous | `presentations`, `refonte`, `livraison` (mesure du débordement) | Mesuré sur Liste, Historique, Stats, Catalogue, Récupération, Réinitialisation, Profils ; pas sur toutes les sections de Réglages (Prix, Notifications, Sauvegarde, À propos) |

## B. Sélection des articles
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| B1 | Trois modes réellement accessibles | ✅ | V3 | P : Réglages → Aperçu V3 → activer ; puis « Préparer les courses » · P active ; S, A voient | `v3-selection` · `v3/{liste,carres,grandes-cartes}-390.png` | Seulement derrière l'aperçu ; par défaut tout le monde reste en V2 |
| B2 | Contrôle de changement de mode visible | ✅ | V3 | « Préparer les courses » → Liste · Carrés · Grandes cartes | `v3-selection` · `v3/carres-390.png` | Libellés seuls, sans icônes |
| B3 | Changement immédiat, mémorisé par utilisateur | ✅ | V3 | Idem | `v3-selection` (profil A garde son choix, S le sien) | Mémorisé sur l'appareil, pas synchronisé entre appareils |
| B4 | Photos nettes et grandes dans les trois modes | 🟡 | V3 | Idem | `v3-selection` (dimensions mesurées) | Netteté non jugée sur un vrai écran ; photos sources en 512 px |
| B5 | Recherche et navigation par catégorie | 🟡 | V3 | Pastilles de catégories + champ de recherche | `audit-v3` | La vue « Par catégories » (grands blocs) de la V2 n'existe pas en V3 |
| B6 | Articles sélectionnés identifiables | ✅ | V3 | Carte verte/orange, coche, quantité, « à valider » | `audit-v3` · `v3/selection-article-identifie-390.png` | — |
| B7 | Quantité choisie visible et modifiable | ✅ | V3 | Texte sur la carte ; toucher → panneau | `v3-selection` | — |
| B8 | Articles déjà achetés et « Nouvelle demande » | ✅ | V3 | Carte verrouillée → panneau « Déjà acheté » → Nouvelle demande | `v3-selection` | — |
| B9 | Le personnel consulte **et sélectionne** les articles actifs sans liste | 🟡 | V2/V3 | « Préparer les courses » sans liste · S | `audit-v3` · `v3/personnel-sans-liste-390.png` | Consultation seule : sélectionner sans liste est impossible (le personnel ne crée pas de liste) ; décision de droits à prendre |
| B10 | Demandes validées par l'administrateur visibles du personnel | ✅ | V2 | Même écran, mise à jour automatique · S | `prix-favoris` (« la sélection d'un administrateur apparaît »), `v3-selection` (achat admin → carte « acheté ») | — |
| B11 | Droits de validation inchangés | ✅ | V2/V3 | Moteur et serveur inchangés · S | `v3-selection` (même résultat qu'en V2), `staff`, tests serveur | — |

## C. Panneau inférieur de quantité
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| C1 | Ouverture au toucher | ✅ | V3 | Toucher une carte · S, A, P | `v3-selection` · `v3/panneau-quantite-390.png` | — |
| C2 | Photo, nom exact, unité adaptée | ✅ | V3 | Panneau | `v3-selection` | — |
| C3 | Boutons +/− et saisie directe | ✅ | V3 | Panneau | `v3-selection` | — |
| C4 | Décimales kg et L ; unités comptées entières | ✅ | V3 | Panneau | `v3-selection` (1,25 ; 2,7 → 3) | — |
| C5 | Conversion kg/g et L/ml sans perte | ✅ | V3 | Panneau → chips kg · g (L · ml) | `v3-selection` (125 g = 0,125 kg stocké) · `v3/panneau-grammes-390.png` | Minimum 10 g (la V2 : 100 g) |
| C6 | Jamais kg → pièce sans conversion fiable | ✅ | V3 | Panneau | `v3-selection` · `v3/panneau-unites-390.png` | — |
| C7 | Modification et retrait d'un article sélectionné | ✅ | V3 | Panneau « Mettre à jour » / « Retirer » | `v3-selection` | — |
| C8 | Clavier : quantité, message, confirmation accessibles | 🟡 | V3 | Panneau | `v3-selection` · `v3/panneau-clavier-390.png` | Clavier simulé (fenêtre réduite) ; à valider avec un vrai clavier |
| C9 | Prix indicatif unitaire si l'affichage est activé | ✅ | V3 | Réglage de prix du profil | `v3-selection`, `audit-v3` | — |
| C10 | Aucun total par article | ✅ | V3 | Sélection | `v3-selection` | — |
| C11 | « Ajouté à la sélection », envoi au moment de Valider | ✅ | V3 | Bouton « Valider » | `v3-selection` (serveur vide avant Valider) · `v3/article-ajoute-390.png` | — |
| C12 | Note facultative | ❌ | — | — | — | Reportée volontairement au lot suivant (décision) |

## D. Liste du jour
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| D1 | Personnel : liste du jour visuelle (maquette 5), boutons actuels | ❌ | — | — · S | — | Le personnel n'a **aucune** liste du jour (ni en V2) : seulement l'écran de choix ; la maquette 5 n'existe pas |
| D2 | Administrateurs : affichage compact | ✅ | V2 | Onglet Liste · P, A | `presentations` · `presentation/administrateur-liste-390.png` | — |
| D3 | Sans liste / liste vide : un seul message court | ✅ | V2 | Onglet Liste · P, A | `livraison` · `livraison/liste-vide-390.png` | — |
| D4 | Aucun compteur à zéro, barre vide, total nul, « Clôturer » inutile | ✅ | V2 | Idem | `livraison` | — |
| D5 | Aucune liste vide créée automatiquement | ✅ | V2 | Liste créée seulement à « Ajouter / modifier » | `livraison`, `parent` | — |
| D6 | Sections vides masquées | ✅ | V2 | Liste, Historique | `livraison`, `presentations` | — |
| D7 | « Tous les articles sont achetés » | ✅ | V2 | Liste | `livraison` · `livraison/liste-tout-achete-390.png` | — |
| D8 | Sélectionné / validé / acheté bien distingués | ✅ | V2/V3 | Écran de choix et Liste | `states-clarity`, `v3-selection` | — |
| D9 | Quantités préservées au changement d'affichage ou de réglage des prix | ✅ | V3 | Changer de mode ; Réglages → Prix | `audit-v3` | — |

## E. Menu administrateur
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| E1 | Menu de gestion compact conforme à la maquette | 🟡 | V2 | Onglet Réglages · P, A | `presentation/administrateur-reglages-390.png` | Entrées différentes de la maquette (pas de « Gestion des prix » ni « Paramètres d'affichage » séparés ; « Adresse de récupération » et « Notifications » en plus) |
| E2 | Catalogue | ✅ | V2 | Réglages → Catalogue · P, A | `presentations`, `catalogue-complet` | — |
| E3 | Gestion des prix (écran dédié) | ❌ | — | — | — | N'existe pas : le prix se modifie article par article (Catalogue → Prix) |
| E4 | Famille et profils | ✅ | V2 | Réglages → Famille et profils · P, A | `partage-acces` · `presentation/administrateur-profils-390.png` | — |
| E5 | Paramètres d'affichage | 🟡 | V2 | Réglages → Prix (cases) et « Mon profil » | `prix-favoris` | Pas d'écran « Paramètres d'affichage » distinct ; mélangé à la synchronisation des prix |
| E6 | Sauvegarde / export | 🟡 | V2 | Réglages → Sauvegarde · P, A | `refonte` | Montre seulement l'état de la sauvegarde automatique ; **aucun export** de données |
| E7 | Réinitialiser la famille | ✅ | V2 | Réglages → Réinitialiser (P seul) | `reinitialisation` · `presentation/administrateur-reinitialisation-390.png` | — |
| E8 | À propos | ✅ | V2 | Réglages → À propos · P, A | `evolutions` | — |
| E9 | Chaque entrée ouvre le bon écran, droits respectés | ✅ | V2 | Réglages · P, A | `presentations`, `acces-recuperation`, `v3-selection` | — |
| E10 | Le personnel ne voit pas les actions d'administration | ✅ | V2 | Pas d'onglet Réglages pour S | `v3-selection`, `staff`, tests serveur | — |

## F. Catalogue et fiche article
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| F1 | Lignes compactes : petite photo, nom, unité, actions courtes | ✅ | V2 | Réglages → Catalogue → Mes produits | `presentations` · `presentation/administrateur-catalogue-390.png` | — |
| F2 | Recherche et filtres compacts | 🟡 | V2 | Idem | `presentations` | Les filtres sont des filtres de photos ; pas de filtre par catégorie ni Affichés/Masqués avec compteurs (maquette) |
| F3 | Affichage/masquage réversible | 🟡 | V2 | Ligne → « ⋯ » → Désactiver / Réactiver | `articles-admin`, `catalogue-complet` | Pas d'interrupteur ni d'onglets Affichés/Masqués avec nombre (maquette) ; le mot est « désactiver » |
| F4 | Catalogue partagé vs articles de la famille | ✅ | V2 | « Mes produits » / « Tous les produits » | `catalogue-complet` | — |
| F5 | Fiche Modifier : photo, nom, catégorie, unité, état actif | ✅ | V2 | Ligne → Modifier | `livraison` · `livraison/fiche-article-390.png` | — |
| F6 | Plus de longs paragraphes techniques | ✅ | V2 | Fiche | `livraison` | — |
| F7 | Plus de « Photo : du catalogue » par ligne | ✅ | V2 | Catalogue | `presentations` | La comparaison de photo reste dans le menu « ⋯ » |
| F8 | Bouton Prix séparé de Modifier | ✅ | V2 | Ligne → Prix (si les prix sont activés pour le profil) | `livraison` | — |
| F9 | Modifier et Prix ciblent l'article exact | ✅ | V2 | Idem | `presentations`, `livraison` (Pâtes / Lentilles) | — |
| F10 | Désactiver un produit ne change pas les anciennes listes | ✅ | V2 | Idem | `articles-admin`, tests serveur (archives immuables) | — |

## G. Gestion des prix
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| G1 | Écran dédié « Gestion des prix » | ❌ | — | — | — | À créer (maquette 3) |
| G2 | Recherche et filtres par catégorie | ❌ | — | — | — | Dépend de G1 |
| G3 | Prix existants visibles | 🟡 | V2 | Dans la fenêtre Prix, et en liste si l'affichage est activé | `prix-favoris` · `livraison/fenetre-prix-390.png` | Le prix n'apparaît pas dans les lignes du catalogue |
| G4 | Modification rapide du prix | 🟡 | V2 | Catalogue → Prix | `livraison` | Article par article ; pas de liste de prix modifiables en ligne |
| G5 | Petite fenêtre : nom, référence courte, Prix (DH), Enregistrer | ✅ | V2 | Catalogue → Prix · P, A | `livraison` · `livraison/fenetre-prix-390.png` | — |
| G6 | Format prérempli ; « Modifier le format » discret | ✅ | V2 | Fenêtre Prix | `livraison`, `prix-favoris` | — |
| G7 | Références de quantité/unité conservées | ✅ | V2 | Fenêtre Prix | `prix-favoris`, tests serveur | — |
| G8 | Prix manquant signalé, jamais zéro | ✅ | V2 | « Prix à compléter » en liste si prix activés | `prix-base-initiale`, `prix-favoris` | — |
| G9 | Prix communs à la famille ; préférences par profil | ✅ | V2 | — | `prix-favoris` | — |
| G10 | État de l'import des prix Marjane | 🟡 | V2 | `docs/prix/controle-import.md` | `prix-base-initiale` : **98 intégrés, 12 en attente, nettoyant sol sans prix** | Non visible dans l'application |
| G11 | Prix observés / estimés distingués | ⚠️ | V2 | Fenêtre Prix | donnée conservée en base et dans `docs/prix` | **Régression** : la mention « observé / moyenne / estimation arrondie » ne s'affiche plus (perdue avec la nouvelle fenêtre) |
| G11b | Aucun rapprochement approximatif entre produits incompatibles | ✅ | V2 | Import par clé stable exacte | `prix-base-initiale`, tests serveur | — |
| G12 | Prix personnalisés jamais écrasés sans décision | ✅ | V2 | Fenêtre Prix ; Synchroniser | `prix-favoris`, `livraison` | — |

## H. Paramètres d'affichage des prix
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| H1 | Prix et totaux désactivés par défaut | ✅ | V2 | — | `prix-favoris` (« simple par défaut ») | — |
| H2 | Option « Afficher les prix indicatifs » | ✅ | V2 | Réglages → Prix ; Mon profil | `prix-favoris` · `prix-favoris/mode-prix.png` | — |
| H3 | Option « total estimé » impliquant les prix | ✅ | V2 | Idem | `prix-favoris` · `prix-favoris/mode-total.png` | — |
| H4 | Préférences par profil, synchronisées entre ses appareils | ✅ | V2 | — | `prix-favoris` | — |
| H5 | Prix seuls : référence unitaire, pas de total par article | ✅ | V2 | Mode « prix indicatifs » | `prix-favoris` | — |
| H6 | Total estimé compatible unités et conditionnements | ✅ | V2 | Mode « total » | `prix-base-initiale` (0,25 kg × 9,90 = 2,48 DH), tests serveur | — |
| H7 | Prix manquants : estimation incomplète | ✅ | V2 | Total estimé | `prix-favoris` | — |
| H8 | Changer les options ne modifie aucune quantité | ✅ | V2/V3 | — | `audit-v3`, `prix-favoris` | — |
| H9 | Historique : comportement | 🟡 | V2 | Historique → liste | code `History.tsx` (PriceTag et EstimateTotal selon les préférences) ; pas de test de bout en bout dédié | Existant : prix et total figés suivent les deux options du profil. Prévu par la maquette : option séparée « prix dans l'historique » — absente |
| H10 | Estimation jamais présentée comme dépense payée | ✅ | V2 | Total estimé | `prix-favoris` (« Montant indicatif… pas une dépense réellement payée ») | — |
| H11 | Prix historiques préservés, pas de réévaluation silencieuse | ✅ | V2 | Archives ; « Réévaluer » explicite | `prix-favoris`, tests serveur | — |

## I. Ville et communauté
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| I1 | Ville demandée à l'installation et à la création d'un profil | ✅ | V2 | Installation ; Famille et profils → Ajouter | `setup`, `livraison` · `livraison/ville-nouveau-profil-390.png` | — |
| I2 | Liste de villes recherchable, cohérente | ✅ | V2 | Même champ | `livraison`, test d'identité serveur/application | 146 villes ; la ville est un nom canonique validé par le serveur, pas un identifiant numérique |
| I3 | Préremplie depuis la ville de P, modifiable | ✅ | V2 | Ajouter un profil | `livraison` | — |
| I4 | Modifiable dans Mon profil | ✅ | V2 | Avatar → Ma ville | `livraison` | — |
| I5 | Anciens profils : demandée au partage/synchronisation, sans bloquer | ✅ | V2 | Réglages → Prix | `livraison` · `livraison/ville-demandee-390.png` | — |
| I6 | Synchroniser : seulement la ville du profil | ✅ | V2 | Réglages → Prix → Synchroniser | `livraison`, tests serveur | — |
| I7 | Compatibilité produit, unité, conditionnement | ✅ | V2 | Idem | `livraison`, tests serveur | — |
| I8 | Prix actuel et prix proposé visibles | ✅ | V2 | Idem | `livraison/synchro-prix-390.png` | — |
| I9 | Sélection puis « Appliquer les prix sélectionnés » | ✅ | V2 | Idem | `livraison` | — |
| I10 | Appliqué aux prix de la famille | ✅ | V2 | Idem | `livraison` | — |
| I11 | Partage volontaire sans identité ni code famille | ✅ | V2 | Prix → Partager ce prix | `prix-favoris`, tests serveur | — |
| I12 | Message « Aucun nouveau prix disponible dans votre ville. » | ✅ | V2 | Synchroniser | `livraison` | — |

## J. Historique, suppression, favoris
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| J1 | Historique administrateur compact | ✅ | V2 | Onglet Historique · P, A | `presentations` · `presentation/administrateur-historique-390.png` | — |
| J2 | Recommander, Validations, menu en barre compacte | ✅ | V2 | Historique → liste | `presentations` | — |
| J3 | Menu Supprimer ancré et visible | ✅ | V2 | « ⋯ » | `presentations` · `presentation/administrateur-historique-menu-390.png` | — |
| J4 | Suppression réservée aux administrateurs, avec confirmation | ✅ | V2 | « ⋯ » → Supprimer la liste · P, A | `livraison` · `livraison/historique-suppression-390.png` | — |
| J5 | Achats supprimés, statistiques recalculées | ✅ | V2 | — | `livraison`, tests serveur | — |
| J6 | Catalogue, favoris, autres listes et familles préservés | ✅ | V2 | — | `livraison`, tests serveur | — |
| J7 | Autres appareils actualisés | 🟡 | V2 | Événement temps réel `list.deleted` | tests serveur (événement) | Rafraîchissement de l'écran d'un second appareil non testé de bout en bout |
| J8 | Action tardive : pas de recréation, pas d'erreur 500 | ✅ | V2 | — | `livraison` (404), tests serveur | — |
| J9 | Recommander : liste modifiable, quantités conservées, achats réinitialisés | ✅ | V2 | Historique → Recommander | `prix-favoris` | — |
| J10 | Favoris : modèles nommés (produits et quantités) | ✅ | V2 | Liste → Favoris | `prix-favoris` · `prix-favoris/favoris-390.png` | — |
| J11 | Ajout / remplacement d'une liste existante | ✅ | V2 | Favoris → choix | `prix-favoris` | — |
| J12 | Modifier la liste ne modifie pas le favori | ✅ | V2 | — | `prix-favoris` | — |

## K. Statistiques
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| K1 | Présentation compacte | ✅ | V2 | Onglet Statistiques · P, A | `presentations` · `presentation/administrateur-statistiques-390.png` | — |
| K2 | Recherche, filtres, période regroupés | ✅ | V2 | Idem | `presentations` | — |
| K3 | Plus de longs textes permanents | ✅ | V2 | Idem | `presentations` | — |
| K4 | Aide à la demande | ✅ | V2 | Bouton « ? » | `presentations` · `presentation/administrateur-statistiques-aide-390.png` | — |
| K5 | Produit, nombre d'achats, quantité, dernier achat | ✅ | V2 | Idem | `presentations`, `evolutions` | — |
| K6 | Graphiques de la maquette (histogramme, répartition par catégorie) | ❌ | — | — | — | Seuls existent : barres par produit et histogramme mensuel dans la fiche d'un produit ; pas de répartition par catégorie |
| K7 | Total estimé distingué des dépenses réelles | ⚠️ | V2 | Aide « ? » | `evolutions` fige encore le texte périmé | Pas de total estimé dans les statistiques ; et le texte de l'aide dit encore « Aucun prix n'est saisi… pas de statistiques de dépenses », **devenu inexact** depuis l'arrivée des prix |
| K8 | Suppression d'une liste répercutée | ✅ | V2 | — | `livraison` | — |

## L. Profils, notifications, réglages
| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| L1 | Gestion des profils et rôles, avec ville | ✅ | V2 | Réglages → Famille et profils | `partage-acces`, `livraison` | — |
| L2 | Administrateur principal protégé | ✅ | V2 | — | `acces-recuperation`, tests serveur | — |
| L3 | Invitation aux notifications : une seule fois par appareil | ✅ | V2 | Écran Liste (P, A, Pa) | `livraison` · `livraison/notifications-invitation-390.png` | Le personnel n'a pas de notifications (refusé par le serveur) |
| L4 | Activer / Plus tard / refus mémorisés | ✅ | V2 | — | `livraison`, `notifications` | **Activation échouée constatée sur votre téléphone** ; cause non encore identifiée (le message d'erreur est maintenant précis) |
| L5 | Réactivation dans Réglages | ✅ | V2 | Réglages → Notifications · P, A | `notifications` | — |
| L6 | Aide à l'activation sur demande seulement | ✅ | V2 | « Comment les activer ? » | `notifications` | — |
| L7 | Adresse de récupération : statut, adresse, actions compactes | ✅ | V2 | Réglages → Adresse de récupération | `presentations` · `presentation/administrateur-recuperation-390.png` | À 360 px les deux boutons passent sur deux lignes |
| L8 | Réinitialisation : avertissement court | ✅ | V2 | Réglages → Réinitialiser | `reinitialisation` | — |
| L9 | Mot de passe, code famille, confirmation conservés | ✅ | V2 | Idem | `reinitialisation` | — |
| L10 | Aucun champ dupliqué ou superposé | ✅ | V2 | Idem | `presentations` · `presentation/administrateur-reinitialisation-390.png` | — |
| L11 | Sauvegardes dans la page de confidentialité | ✅ | V2 | `/confidentialite` (public) | `confidentialite` | — |

## M. Recette et Android
| # | Élément | Statut | Version | Accès | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| M1 | Branche V3 isolée, sans déploiement | ✅ | V3 | `claude/v3-selection` | historique git | — |
| M2 | Aperçu désactivé par défaut, activation réservée au principal | ✅ | V3 | Réglages → Aperçu V3 | `v3-selection` | — |
| M3 | Retour immédiat à la V2 | ✅ | V3 | Lien « revenir à la V2 » ; Réglages | `v3-selection` | — |
| M4 | Activation puis test du personnel sur le même appareil | ✅ | V3 | P active, S se connecte | `v3-selection` | — |
| M5 | Autres appareils restent en V2 | ✅ | V3 | — | `v3-selection` | — |
| M6 | APK de recette distincte | ✅ | V3 | `app.smartcourse.courses.recette`, « Courses V3 essai » | contrôle de paquet dans le workflow | Installation sur un vrai téléphone non faite |
| M7 | APK reliée uniquement à la base d'essai | ✅ | V3 | Adresse du tunnel codée dans l'APK | workflow `verify-tunnel` | — |
| M8 | Expiration indiquée | 🟡 | V3 | Statut du commit `recette/acces` | — | Heure affichée « 18:22 Maroc » alors que c'est 18:22 UTC (19:22 Maroc) : corrigé pour les prochaines sessions |
| M9 | Validation sur un vrai téléphone | ❌ | — | — | — | Aucun test réel à ce jour (hors votre capture montrant l'échec des notifications) |
| M10 | Captures réelles 360/390 px | 🟡 | V3 | `docs/captures/` | — | Captures de Chromium émulant 360/390 px, pas d'un téléphone réel |

## Lot 2 — régressions et parcours personnel (mise à jour)
Branche `claude/v3-selection`, derrière l'aperçu V3 pour la partie personnel ; aucune fusion, aucun déploiement.

| # | Élément | Statut | Version | Accès · rôles | Preuve | Ce qui manque |
|---|---|---|---|---|---|---|
| G11 | Nature du prix (observé / estimé), détail à la demande | ✅ | V3 | Catalogue → Prix → pastille + « D'où vient ce prix ? » ; panneau de quantité (pastille) · P, A, S | `v3-personnel` · `v3/prix-nature-observe-390.png`, `prix-nature-estime-390.png` | Prix de la famille : pas de pastille, détail « Prix saisi par votre famille » |
| K7 | Aide des statistiques exacte | ✅ | V3 | Statistiques → « ? » | `evolutions` (texte mis à jour) | Total estimé et répartition : lot Statistiques |
| B9 | Sélection par le personnel sans liste (brouillon) | ✅ | V3 | « Choisir » · S | `v3-personnel`, `audit-v3` · `v3/personnel-sans-liste-brouillon-390.png` | — (V2 inchangée : lecture seule sans liste) |
| B9b | Validation qui crée la liste, sans droit en plus | ✅ | V3 | Bouton « Valider » · S | `v3-personnel`, tests serveur `active-list-requests` · `v3/personnel-validation-390.png` | Le personnel ne crée, ne clôture ni n'achète toujours rien (403 vérifiés) |
| B9c | Deux appareils qui valident en même temps | ✅ | V3 | — | `v3-personnel`, tests serveur | Une seule liste en cours ; aucune demande perdue ; rejeu d'un lot sans doublon |
| B9d | Validation hors connexion sans liste | ✅ | V3 | — | `v3-personnel` | Annoncée « gardée sur ce téléphone » tant que le serveur n'a pas répondu |
| D1 | Liste du jour du personnel | ✅ | V3 | Onglet « Liste du jour » · S | `v3-personnel` · `v3/liste-du-jour-demandes-390.png`, `liste-du-jour-progression-390.png`, `liste-du-jour-a-valider-390.png` | Le personnel ne marque aucun achat (droit inchangé) |
| D1b | États À valider / Demandé / Acheté distincts | ✅ | V3 | Liste du jour, écran de choix | `v3-personnel` | Il n'existe pas d'étape d'approbation par un administrateur : « Demandé » = enregistré dans la liste |
| D1c | Progression sur les articles réellement à acheter | ✅ | V3 | Liste du jour | `v3-personnel` (brouillon exclu ; 1 sur 3 = 33 %) | — |
| D1d | Filtres Tous / À acheter / Achetés | ✅ | V3 | Liste du jour | `v3-personnel` | — |
| D1e | Confirmation permettant de rejoindre la liste | ✅ | V3 | Après « Valider » : « Voir la liste du jour » | `v3-personnel` | — |
| B1b | Trois modes visibles sur l'écran de sélection | ✅ | V3 | Choisir | `v3-personnel`, `v3-selection` | — |
| B1c | Nombre réel d'articles accessibles | ✅ | V3 | Choisir (« 80 articles ») | `v3-personnel` (égal au catalogue actif) | — |

## Lot 3 et 4 — Gestion des prix et Catalogue (mise à jour)
Branche `claude/v3-selection` ; aucune fusion, aucun déploiement, aucune donnée réelle touchée. Validation visuelle sur téléphone : **non faite** (captures = Chromium émulé 360/390 px).

| # | Élément | Statut | Accès · rôles | Preuve |
|---|---|---|---|---|
| G1 | Écran dédié « Gestion des prix », entrée dans le menu admin | ✅ | Menu admin → Gestion des prix · A, P | `v3-prix-catalogue` · `v3/gestion-prix-{360,390}.png` |
| G2 | Recherche, filtre par catégorie, bascule « À compléter (n) » | ✅ | idem | `v3/gestion-prix-a-completer-*.png` |
| G3 | Modification rapide (photo · nom · prix · unité de référence) | ✅ | idem | `v3/gestion-prix-modification-*.png` |
| G4 | Prix manquants signalés | ✅ | idem | idem |
| G5 | Synchronisation des prix de la ville | ✅ | idem | `v3/gestion-prix-synchro-390.png` |
| G6 | Accès Catalogue → Prix, références de conditionnement, prix personnalisés et anciennes listes conservés | ✅ | Catalogue | `prix-favoris`, `articles-admin` |
| F1 | Catalogue compact, onglets Tous / Affichés / Masqués avec compteurs réels | ✅ | Catalogue · A, P | `v3/catalogue-onglets-*.png` |
| F2 | Interrupteurs réversibles, libellés Affiché / Masqué, aucun historique modifié ou supprimé | ✅ | idem | `v3/catalogue-masques-*.png` |
| F3 | Actions courtes Modifier et Prix | ✅ | idem | `v3-prix-catalogue` |
| B9e | Libellés simples « Sélection en cours », « À acheter », « Acheté » ; hors ligne : « Envoi en attente » | ✅ | Personnel | `v3-personnel` |
| B9f | Brouillon isolé par famille et par profil, avis en cas de perte au changement de compte | ✅ | Personnel | `v3-personnel-securite` |
| B9g | Demande hors ligne après clôture/suppression de liste : pas d'ajout à une archive, pas de recréation, pas de perte silencieuse (« Reprendre ») | ✅ | Personnel | `v3-personnel-securite` |
| D1f | Progression calculée sur les seuls articles enregistrés, état vide propre | ✅ | Personnel | `v3-personnel-securite` |

Toujours différé : note facultative, export (non affiché), étapes 5–7, défaut d'activation des notifications (à diagnostiquer sur téléphone).
