/** Pays proposés à la création d'une famille (code ISO, nom français, devise proposée pour le budget et ses décimales). */
export interface Country { code: string; name: string; currency: string; decimals: number }

export const COUNTRIES: Country[] = [
  { code: "MA", name: "Maroc", currency: "MAD", decimals: 2 },
  { code: "DZ", name: "Algérie", currency: "DZD", decimals: 2 },
  { code: "TN", name: "Tunisie", currency: "TND", decimals: 3 },
  { code: "MR", name: "Mauritanie", currency: "MRU", decimals: 2 },
  { code: "SN", name: "Sénégal", currency: "XOF", decimals: 0 },
  { code: "CI", name: "Côte d'Ivoire", currency: "XOF", decimals: 0 },
  { code: "ML", name: "Mali", currency: "XOF", decimals: 0 },
  { code: "CM", name: "Cameroun", currency: "XAF", decimals: 0 },
  { code: "EG", name: "Égypte", currency: "EGP", decimals: 2 },
  { code: "FR", name: "France", currency: "EUR", decimals: 2 },
  { code: "BE", name: "Belgique", currency: "EUR", decimals: 2 },
  { code: "LU", name: "Luxembourg", currency: "EUR", decimals: 2 },
  { code: "CH", name: "Suisse", currency: "CHF", decimals: 2 },
  { code: "ES", name: "Espagne", currency: "EUR", decimals: 2 },
  { code: "IT", name: "Italie", currency: "EUR", decimals: 2 },
  { code: "DE", name: "Allemagne", currency: "EUR", decimals: 2 },
  { code: "NL", name: "Pays-Bas", currency: "EUR", decimals: 2 },
  { code: "PT", name: "Portugal", currency: "EUR", decimals: 2 },
  { code: "GB", name: "Royaume-Uni", currency: "GBP", decimals: 2 },
  { code: "IE", name: "Irlande", currency: "EUR", decimals: 2 },
  { code: "SE", name: "Suède", currency: "SEK", decimals: 2 },
  { code: "NO", name: "Norvège", currency: "NOK", decimals: 2 },
  { code: "DK", name: "Danemark", currency: "DKK", decimals: 2 },
  { code: "CA", name: "Canada", currency: "CAD", decimals: 2 },
  { code: "US", name: "États-Unis", currency: "USD", decimals: 2 },
  { code: "AE", name: "Émirats arabes unis", currency: "AED", decimals: 2 },
  { code: "SA", name: "Arabie saoudite", currency: "SAR", decimals: 2 },
  { code: "QA", name: "Qatar", currency: "QAR", decimals: 2 },
  { code: "TR", name: "Turquie", currency: "TRY", decimals: 2 },
];

export const isCountry = (code: string): boolean => COUNTRIES.some((c) => c.code === code);
/** Prix indicatifs du catalogue : seulement au Maroc. Une famille sans pays confirmé garde le comportement actuel (prix disponibles). */
export const pricesAvailable = (country: string | null | undefined): boolean => !country || country === "MA";
