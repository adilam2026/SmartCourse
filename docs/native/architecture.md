# Courses — application Android native : architecture retenue (prototype visuel)

Branche : `claude/android-native` (aucun déploiement automatique). Module : `android-native/` (projet Gradle autonome).
Identifiant de recette : `app.smartcourse.courses.nativeproto` (s'installe à côté de l'application actuelle ; nom affiché « Courses (natif) »).

## Ce qui est natif
| Sujet | Choix |
|---|---|
| Langage / UI | Kotlin 2.0.21 + **Jetpack Compose** (BOM 2024.12.01, Compose UI/Foundation 1.7.6) |
| Composants | **Material 3** (`ModalBottomSheet`, `AlertDialog`, `DropdownMenu`, `OutlinedTextField`, `Switch`, `IconButton`) personnalisés par un thème (`Theme.kt`) et des composants maison (`Components.kt`) : boutons à profondeur, cartes à relief, onglets segmentés, barre de navigation |
| Navigation | **Navigation Compose** 2.8.5 (pile de retour native ; touche Retour Android gérée par le système) |
| Fenêtre | `enableEdgeToEdge`, marges système (barre d'état, barre de navigation, clavier `imePadding`) |
| Icônes | Material Icons Extended (vectoriel) |
| Photos | Photos existantes du catalogue (`server/catalog-photos`), redimensionnées 288 px, embarquées en ressources `drawable-nodpi` |
| Données | Fictives, locales, en mémoire (`Data.kt`) |
| Réseau | **Aucune permission** déclarée (donc aucun accès Internet possible). Vérifié par le workflow (`aapt2 dump badging` : zéro `uses-permission`) |

## Ce qui est absent (volontairement)
Aucun WebView, TWA, Capacitor, Cordova, navigateur intégré. Aucun composant React, HTML ou CSS. Le workflow échoue si le dex contient « androidbrowserhelper », « customtabs », « capacitor » ou « cordova », ou si l'arbre de dépendances contient webkit/browser. Preuves publiées à chaque exécution : `docs/native/preuves/` (`dependances.txt`, `webview.txt`, `badging.txt`).

## Présentations
- Administrateur : compacte (`LocalCompact = true`) : lignes de 44–52 dp, boutons 48 dp.
- Personnel : confortable (`LocalCompact = false`) : photos 72 dp, boutons 56 dp, zones tactiles ≥ 44 dp.
- Un bandeau permanent « PROTOTYPE · données fictives » et un menu « Écrans de démo » permettent de naviguer ; les actions simulées affichent « Action simulée : … ».

## Fichiers
`MainActivity.kt` (navigation, bandeau, menu de démo) · `Theme.kt` · `Components.kt` · `Forms.kt` · `Data.kt` (modèle fictif, unités exactes g/kg, ml/L) · `Login.kt` (V01) · `Lists.kt` (V02, V03) · `Selection.kt` (V04, V05) · `History.kt` (V06) · `Settings.kt` (V07, V08, V11) · `Catalog.kt` (V09, V10) · `Stats.kt` (V12).

## Vérification dans ce dépôt
Le bac à sable de développement n'a pas accès aux dépôts Google : compilation, exécution et captures sont faites par GitHub Actions (`.github/workflows/native-proto.yml`) : APK release compilé (R8), installé sur un **émulateur Android 14 (API 34, profil Pixel 6)**, ouvert sur chaque écran, capturé par `adb screencap` à 360 dp puis 390 dp (`scripts/native-captures.sh`). Ce ne sont pas des images générées. Ce n'est pas un téléphone réel.
