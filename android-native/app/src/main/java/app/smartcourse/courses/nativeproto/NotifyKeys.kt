package app.smartcourse.courses.nativeproto

/** Clés locales des notifications d'un profil (communes : la liste en cours les met à jour sur toutes les plateformes). */
object NotifyKeys {
    fun key(scope: String) = "notif|$scope"
    fun seenKey(scope: String) = "seenval|$scope"
}
