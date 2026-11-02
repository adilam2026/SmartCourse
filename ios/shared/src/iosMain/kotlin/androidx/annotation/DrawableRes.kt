package androidx.annotation

/** Annotation de documentation d'Android (identifiant d'image), sans effet : reprise telle quelle pour les écrans communs. */
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.VALUE_PARAMETER, AnnotationTarget.FIELD, AnnotationTarget.PROPERTY, AnnotationTarget.FUNCTION, AnnotationTarget.LOCAL_VARIABLE)
annotation class DrawableRes
