# Matrice de contrôle — prototype Android natif (run 3, commit `f57e40b`)

Légende : **R** réalisé · **P** partiel · **N** non réalisé. « Capture » = fichier dans `docs/native/captures/` (suffixes `-360.png` et `-390.png`, captures **de l'émulateur Android 14 / Pixel 6**, pas d'un téléphone réel). Un écran « réalisé » signifie : conforme visuellement dans le prototype ; **aucune fonctionnalité métier n'est branchée** (données fictives).

## 1. Architecture
| Id | Attendu | État | Écran / preuve | Écart |
|---|---|---|---|---|
| A1 | Kotlin + Jetpack Compose | R | `android-native/`, `preuves/dependances.txt` | — |
| A2 | Composants, navigation, fenêtres, formulaires Android natifs | R | Material 3 (`ModalBottomSheet`, `AlertDialog`, `DropdownMenu`, `OutlinedTextField`, `Switch`), Navigation Compose | Boutons, cartes, onglets et barre de navigation sont des composants Compose maison (comportement natif conservé) |
| A3 | Aucun WebView / TWA / Capacitor | R | Workflow : échec si trace dans le dex ou les dépendances ; `preuves/webview.txt` = 0 référence | — |
| A4 | Pas de composants React / HTML / CSS | R | Aucun fichier web dans le module | — |
| A5 | Réutiliser backend/API/règles | N (prévu) | `plan-migration.md` | Hors périmètre de ce lot : prototype à données fictives |
| A6 | Droits, isolation des familles, synchro, hors connexion, brouillons côté Android | N (prévu) | `plan-migration.md` étapes 1–5 | À reconstruire après validation visuelle |
| A7 | Application actuelle conservée | R | Aucun fichier existant modifié ; branche `claude/android-native` | — |
| A8 | Module + branche dédiés + identifiant de recette distinct | R | `app.smartcourse.courses.nativeproto`, nom « Courses (natif) » | — |
| A9 | Architecture indiquée clairement | R | `architecture.md` | — |

## 2. Direction visuelle (planche jointe)
| Id | Attendu | État | Preuve | Écart |
|---|---|---|---|---|
| D1 | Bleu nuit et turquoise | R | toutes | — |
| D2 | Fond clair légèrement bleuté | R | `#F2F7FB` | — |
| D3 | Cartes blanches à relief discret | R | V02, V06, V09… | — |
| D4 | Boutons modernes à profondeur légère | R | dégradé + ombre colorée | — |
| D5 | Photos nettes et mises en valeur | R | V04 carrés / grandes cartes | Photos 288 px : légère perte de netteté en « grandes cartes » sur grands écrans |
| D6 | Typographie et icônes cohérentes | P | police système Roboto ; Material Icons | La planche semble utiliser une police plus arrondie : non reproduite (aucune police embarquée) |
| D7 | Administrateur compact / personnel confortable | R | V02 vs V03 | — |
| D8 | Ne pas reprendre l'ancien écran web recoloré | R | — | Jugement visuel à confirmer par vous |
| D9 | Composants Android personnalisés | R | thème `Theme.kt` | — |
| D10 | Photos existantes ; prix/dates/références de la planche non importés comme réels | R | 28 photos du catalogue ; prix fictifs propres | — |
| D11 | « Très proche de la planche » | P | `planche-ensemble.png` | Illustration (sac de courses) de la connexion remplacée par un collage de photos ; mise en page proche mais non identique au pixel près |

## 3. Écrans
| Id | Attendu | État | Écran | Capture | Écart |
|---|---|---|---|---|---|
| V01a | Deux onglets Se connecter / Première connexion | R | Connexion | `V01-connexion` | — |
| V01b | Un seul contenu visible à la fois | R | idem | `V01-premiere-rejoindre`, `V01-premiere-creer` | — |
| V01c | Première connexion : Rejoindre / Créer | R | idem | idem | — |
| V01d | Récupération regroupée dans « Besoin d'aide » | R | idem | `V01-aide` | — |
| V01e | Pas d'empilement de formulaires | R | idem | `V01-connexion` | — |
| V02a | Présentation compacte | R | Liste admin | `V02-liste-admin` | — |
| V02b | Une action principale « Ajouter des articles », Favoris secondaire | R | idem | idem, `V02-favoris` | — |
| V02c | Clôturer dans le menu, avec confirmation | R | idem | `V02-menu`, `V02-cloture-confirmation` | — |
| V02d | Tout acheté : « Terminer les courses » | R | idem | `V02-tout-achete` | — |
| V02e | Aucun bouton/compteur « Validations » | R | idem | toutes | — |
| V03a | Photos et quantités bien visibles | R | Liste personnel | `V03-liste-personnel` | — |
| V03b | Actions confortables selon les droits existants | P | idem | `V03-a-acheter` | Le personnel modifie/retire les articles non achetés et ne coche aucun achat (droit existant) : **simulé**, droits non appliqués par un serveur |
| V03c | Progression + filtres Tous / À acheter / Achetés | R | idem | idem | Les puces de filtre mesurent 36 dp (< 44 dp conseillés pour le personnel) : à agrandir si vous le souhaitez |
| V03d | État vide simple, sans sections ni compteurs | R | idem | `V03-vide` | — |
| V04a | Mode Liste visuelle | R | Sélection | `V04-selection-liste` | — |
| V04b | Mode Carrés, deux colonnes | R | idem | `V04-selection-carres` | — |
| V04c | Mode Grandes cartes | R | idem | `V04-selection-grandes-cartes` | — |
| V04d | Changement immédiat, état sélectionné évident | R | idem | bordure turquoise + coche | — |
| V04e | Une seule action finale « Terminer ma sélection » | R | idem | toutes | — |
| V05a | Panneau inférieur natif | R | Quantité | `V05-quantite-kg` | — |
| V05b | Photo, nom, quantité, +/−, saisie directe | R | idem | idem | — |
| V05c | Unité adaptée ; kg/g et L/ml avec conversion fiable | R | idem | `V05-quantite-g`, `V05-quantite-litre` | Quantités entières en g/ml : exactes |
| V05d | Aucun passage kg → pièce | R | idem | `V05-quantite-piece` (pièces sans autre unité) | — |
| V05e | Prix unitaire seulement si activé ; aucun total par article | R | idem | `V05-quantite-prix-actifs` vs `V05-quantite-kg` | — |
| V05f | État clavier ouvert | R | idem | `V05-quantite-clavier` | Correction apportée au run 3 (le clavier ne s'ouvrait pas au run 2) |
| V06a | Liste et détail compacts | R | Historique | `V06-historique`, `V06-detail` | — |
| V06b | Recommander accessible | R | idem | boutons + menu | — |
| V06c | Supprimer dans un menu visible + confirmation | R | idem | `V06-historique-menu`, `V06-suppression-confirmation` | — |
| V06d | Plus d'interface « Historique des validations » | R | idem | aucune | Traces serveur : sans objet dans le prototype |
| V07a | Quatre groupes (Produits et prix, Famille et accès, Préférences, Application) | R | Administration | `V07-administration` | — |
| V07b | Réinitialiser la famille distinct et discret | R | idem | `V07-reinitialiser` | — |
| V07c | Pas d'entrée Prix en doublon | R | idem | idem | — |
| V07d | Récupération, Notifications, Sauvegarde, À propos | P | idem | écran « Hors du périmètre visuel » | Ces quatre écrans ne sont pas conçus (non demandés en V01–V12) |
| V08a | Avatar, nom, rôle en lignes compactes ; actions groupées | R | Profils | `V08-profils`, `V08-menu-profil` | — |
| V08b | Suppression pour administrateurs autorisés + confirmation | R | idem | `V08-suppression-confirmation` | Visuel/simulation uniquement |
| V08c | Administrateur principal et dernier administrateur actif protégés | R | idem | `V08-menu-protege` | Logique reproduite dans la démo, pas côté serveur |
| V08d | Achats partagés conservés ; attribution historique | P | idem | texte de confirmation | Texte seulement ; le traitement réel viendra avec le serveur |
| V08e | Désactivation ≠ suppression | R | idem | `V08-menu-profil` + note | — |
| V09a | Filtres Tous / Dans mon catalogue / À ajouter, avec compteurs | R | Catalogue | `V09-catalogue-*` | — |
| V09b | Recherche et catégories | R | idem | idem | — |
| V09c | Tous : présents d'abord | R | idem | `V09-catalogue-tous` | — |
| V09d | Retirer / Ajouter ; retrait réversible | R | idem | annulation par message « Annuler » | Pas de capture du message (disparaît en 3 s) |
| V10a | Lignes compactes et uniformes | R | Gestion des prix | `V10-prix` | — |
| V10b | Prix existant actionnable ; absent : « Ajouter un prix » | R | idem | `V10-prix`, `V10-prix-manquants` | — |
| V10c | Aucun badge observé/estimé ; provenance à la demande | R | idem | `V10-prix-modification` (« D'où vient ce prix ? ») | Texte de provenance générique |
| V10d | Fenêtre de modification courte | R | idem | idem | — |
| V10e | Synchronisation par ville | R | idem | `V10-prix-synchronisation` | — |
| V11a | Prix indicatifs et total estimé désactivés par défaut | R | Affichage | `V11-affichage` | — |
| V11b | Options compréhensibles, sans doublon ; propres au profil | R | idem | idem | — |
| V11c | Aucun changement de quantité | R | idem | mention affichée | — |
| V12a | Présentation compacte ; période, indicateurs, graphiques | R | Statistiques | `V12-statistiques` | Graphiques simples (barres), non interactifs |
| V12b | Estimation distinguée de la dépense payée | R | idem | idem | — |
| V12c | Pas de long texte permanent ; aide à la demande | R | idem | `V12-aide` | — |

## 4. Livraison visuelle
| Id | Attendu | État | Preuve | Écart |
|---|---|---|---|---|
| L1 | Captures de chaque écran dans la conversation | R | envoyées | — |
| L2 | Planche d'ensemble | R | `planche-ensemble.png` | — |
| L3 | APK installable à côté de l'application actuelle | R | préversion `native-proto-3` | Signé par une clé jetable d'essai |
| L4 | Données fictives locales, sans tunnel | R | aucune permission réseau (`badging.txt`) | — |
| L5 | Navigation de démonstration | R | bandeau « Écrans de démo » | — |
| L6 | Aucun accès/écriture aux données réelles | R | aucune permission réseau | — |
| L7 | Actions simulées identifiées | R | messages « Action simulée : … » | Les actions locales (catalogue) sont signalées « (simulation) » |
| L8 | Captures issues du prototype exécuté | R | `adb screencap` sur émulateur | Pas de téléphone réel |
| L9 | Largeurs 360 et 390 dp | R | 51 écrans ou états capturés à chaque largeur (+ 3 captures du contrôle du retour Android à 360) ; 360 relues en entier, 390 relues par échantillon | — |
| L10 | Textes longs | P | variantes V02, V03, V04, V08 | V12 : pas de texte long à tester |
| L11 | Clavier | R | V01, V05 | — |
| L12 | Retour Android | R | `controles.txt` : retour à l'écran précédent OK ; retour = fermeture du clavier sans quitter OK | — |
| L13 | Marges système | R | affichage bord à bord, barres d'état et de navigation | Une seule version Android (14) et un seul mode de navigation (gestes) testés |
| L14 | Zones tactiles confortables (personnel) | P | boutons 56 dp, stepper 44 dp | puces de filtre 36 dp |
| L15 | Aucun plantage | R | `controles.txt` : `CRASH_LIGNES=0` | — |

## Non vérifié
Téléphone réel, TalkBack, grande taille de police, mode sombre (non géré : thème clair unique), tablettes, rotation, Android < 14.
