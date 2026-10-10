import java.net.URI

plugins {
    id("com.android.application")
}

// Adresse stable du serveur (Railway). Surchargeable : ./gradlew assembleRelease -PappUrl=https://exemple.up.railway.app
val appUrl = (project.findProperty("appUrl") as String?) ?: "https://smartcourse-production-c7ce.up.railway.app"
val appHost = URI(appUrl).host

android {
    namespace = "app.smartcourse.courses"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.smartcourse.courses"
        minSdk = 24
        targetSdk = 36
        // Google Play exige un versionCode strictement croissant : le workflow passe le numéro d'exécution.
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "1.0.0"
        manifestPlaceholders["appUrl"] = "$appUrl/"
        manifestPlaceholders["appHost"] = appHost
        resValue("string", "asset_statements", """[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"web","site":"$appUrl"}}]""")
    }

    // La clé de signature n'est JAMAIS dans le dépôt : chemin et mots de passe viennent de l'environnement (secrets GitHub).
    signingConfigs {
        create("release") {
            val path = System.getenv("ANDROID_KEYSTORE_PATH")
            if (path != null) {
                storeFile = file(path)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Le contrôle de lint ne doit pas bloquer la génération ; ses résultats sont publiés par le workflow.
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.6.2")
    implementation("androidx.appcompat:appcompat:1.7.1")
}

// Refuse de produire un APK/AAB « release » sans clé : un fichier non signé n'est pas installable.
gradle.taskGraph.whenReady {
    if (allTasks.any { it.name.contains("Release") && (it.name.startsWith("assemble") || it.name.startsWith("bundle")) } &&
        System.getenv("ANDROID_KEYSTORE_PATH") == null
    ) {
        throw GradleException("ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS et ANDROID_KEY_PASSWORD sont requis pour une version release.")
    }
}
