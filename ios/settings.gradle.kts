// Version iPhone (Kotlin Multiplatform + Compose Multiplatform), étape 1 : build SÉPARÉ du projet Android, qui reste inchangé.
// Le module « shared » compile pour iOS les MÊMES fichiers source que l'application Android (android-native/app/src/main/java).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "CoursesIos"
include(":shared")
