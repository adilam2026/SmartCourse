package app.smartcourse.courses.nativeproto

import app.smartcourse.courses.nativeproto.net.ProfileDto

/**
 * Règles de protection des profils, reprises à l'identique du serveur (server/src/profiles.ts) pour griser les actions impossibles.
 * Le serveur reste seul juge : il refuse (409) toute action qui les violerait, même si l'application se trompait.
 */
object ProfileRules {
    fun activeAdmins(all: List<ProfileDto>) = all.count { it.role == "admin" && it.active }

    /** Le rôle de l'administrateur principal est fixe ; le dernier administrateur actif ne peut pas être rétrogradé ; on ne change pas son propre rôle ici. */
    fun canChangeRole(p: ProfileDto, all: List<ProfileDto>, meId: String?) =
        !p.primary && p.id != meId && !(p.role == "admin" && p.active && activeAdmins(all) <= 1)

    /** Un administrateur n'est jamais désactivé : il faut d'abord lui retirer ce rôle. Réactiver est toujours permis. */
    fun canDeactivate(p: ProfileDto) = p.active && p.role != "admin"

    /** Ni l'administrateur principal, ni un administrateur (retirer d'abord le rôle), ni soi-même. */
    fun canDelete(p: ProfileDto, meId: String?) = !p.primary && p.role != "admin" && p.id != meId

    fun roleLabel(p: ProfileDto) = when {
        p.primary -> "Administrateur principal"
        p.role == "admin" -> "Administrateur"
        p.role == "parent" -> "Parent"
        else -> "Personnel"
    }
}
