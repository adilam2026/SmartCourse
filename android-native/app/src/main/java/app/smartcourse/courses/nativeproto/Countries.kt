package app.smartcourse.courses.nativeproto

/** Pays proposés (même liste que le serveur, server/src/countries.ts) : code ISO, nom, devise proposée pour le budget. */
data class Country(val code: String, val name: String, val currency: String, val decimals: Int)

val COUNTRIES = listOf(
    Country("MA", "Maroc", "MAD", 2),
    Country("DZ", "Algérie", "DZD", 2),
    Country("TN", "Tunisie", "TND", 3),
    Country("MR", "Mauritanie", "MRU", 2),
    Country("SN", "Sénégal", "XOF", 0),
    Country("CI", "Côte d'Ivoire", "XOF", 0),
    Country("ML", "Mali", "XOF", 0),
    Country("CM", "Cameroun", "XAF", 0),
    Country("EG", "Égypte", "EGP", 2),
    Country("FR", "France", "EUR", 2),
    Country("BE", "Belgique", "EUR", 2),
    Country("LU", "Luxembourg", "EUR", 2),
    Country("CH", "Suisse", "CHF", 2),
    Country("ES", "Espagne", "EUR", 2),
    Country("IT", "Italie", "EUR", 2),
    Country("DE", "Allemagne", "EUR", 2),
    Country("NL", "Pays-Bas", "EUR", 2),
    Country("PT", "Portugal", "EUR", 2),
    Country("GB", "Royaume-Uni", "GBP", 2),
    Country("IE", "Irlande", "EUR", 2),
    Country("SE", "Suède", "SEK", 2),
    Country("NO", "Norvège", "NOK", 2),
    Country("DK", "Danemark", "DKK", 2),
    Country("CA", "Canada", "CAD", 2),
    Country("US", "États-Unis", "USD", 2),
    Country("AE", "Émirats arabes unis", "AED", 2),
    Country("SA", "Arabie saoudite", "SAR", 2),
    Country("QA", "Qatar", "QAR", 2),
    Country("TR", "Turquie", "TRY", 2),
)

fun countryName(code: String?): String? = COUNTRIES.firstOrNull { it.code == code }?.name
