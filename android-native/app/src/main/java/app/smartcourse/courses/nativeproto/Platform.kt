package app.smartcourse.courses.nativeproto

/**
 * Actions du système demandées par les écrans communs. Chaque plateforme les fournit ([platformHost]) : Android (PlatformAndroid.kt)
 * et iPhone (ios/shared/src/iosMain). Les écrans et les règles restent les mêmes.
 */
interface PlatformHost {
    /** Partage d'un message d'accès : WhatsApp s'il est installé, sinon la feuille de partage. « none » si rien n'est disponible. */
    fun share(text: String, title: String): String
    /** Feuille de partage du système ; false si rien n'est disponible. */
    fun shareSheet(text: String, title: String): Boolean
    /** Copie dans le presse-papiers, marquée sensible (non affichée dans l'aperçu du système). */
    fun copy(label: String, text: String)
    /** Ouvre une page dans le navigateur ; false si impossible. */
    fun openUrl(url: String): Boolean
}
