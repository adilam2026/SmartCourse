import { ApiError, NetworkError } from "./api";

/**
 * What a person reads when something fails. Only these sentences ever reach the screen: raw server messages, status codes and
 * identifiers stay out (the real cause is in the server logs). Every sentence says what to do next.
 */
const BY_CODE: Record<string, string> = {
  invalid_credentials: "Identifiants incorrects ou accès temporairement bloqué. Vérifiez la saisie ou réessayez plus tard.",
  unauthenticated: "Votre session a expiré. Reconnectez-vous.",
  wrong_password: "Mot de passe incorrect.",
  code_mismatch: "Le code famille saisi ne correspond pas.",
  weak_secret: "Code secret trop simple (évitez 123456, 111111…).",
  secret_mismatch: "Les deux codes secrets ne sont pas identiques.",
  invalid_secret: "Le code secret doit comporter exactement 6 chiffres.",
  login_taken: "Cet identifiant existe déjà.",
  last_admin: "Impossible : c'est le dernier administrateur actif.",
  admin_cannot_deactivate: "Un administrateur ne peut pas être désactivé.",
  primary_admin_protected: "Le rôle de l'administrateur principal ne peut pas être modifié.",
  product_exists: "Un article de ce nom existe déjà.",
  invalid_image: "Cette image ne peut pas être lue. Choisissez une photo JPEG, PNG ou WebP.",
  unsupported_media_type: "Choisissez une photo JPEG, PNG ou WebP.",
  image_too_large: "Cette image est trop volumineuse (8 Mo au maximum).",
  email_required: "Une adresse e-mail de récupération est obligatoire.",
  email_not_verified: "L'adresse doit d'abord être vérifiée.",
  no_email: "Aucune adresse de récupération n'est enregistrée.",
  too_soon: "Un lien vient d'être envoyé. Patientez un instant avant de le renvoyer.",
  too_many_mails: "Trop d'e-mails envoyés à cette adresse. Réessayez dans une heure.",
  mail_unavailable: "L'e-mail n'a pas pu être envoyé. Veuillez réessayer dans quelques instants.",
  invalid_link: "Ce lien n'est plus valable. Demandez-en un nouveau.",
  setup_incomplete: "Installation à terminer : vérifiez votre adresse e-mail.",
  reset_not_ready: "Vérifiez d'abord votre adresse e-mail de récupération.",
  active_exists: "Une liste est déjà en cours.",
  op_in_progress: "Une opération est déjà en cours. Réessayez dans un instant.",
  primary_cannot_delete: "Le profil principal ne peut être supprimé qu'avec toute la famille (Réglages → Réinitialiser la famille).",
  admin_cannot_delete: "Retirez d'abord le rôle administrateur de ce profil.",
  invalid_price: "Le prix doit être un montant en dirhams, avec 2 décimales au plus.",
  invalid_price_ref: "La quantité de référence du prix est invalide (en g ou ml : un nombre entier).",
  not_shareable: "Ce produit n'existe que dans votre famille : il ne peut pas être partagé.",
  no_family_price: "Seul un prix que vous avez modifié peut être partagé.",
  already_shared: "Ce prix a déjà été partagé aujourd'hui.",
  too_many_contributions: "Vous avez déjà partagé beaucoup de prix aujourd'hui. Réessayez plus tard.",
  price_inconsistent: "Ce prix semble très différent des prix connus : vérifiez le montant et l'unité avant de le partager.",
  invalid_date: "La date du prix n'est pas valable.",
  proposal_gone: "Cette proposition n'est plus disponible. Actualisez la liste.",
  template_exists: "Un favori porte déjà ce nom.",
  too_many_templates: "Nombre maximal de favoris atteint.",
  too_many_items: "Trop de produits dans ce favori.",
  empty_template: "Cette liste est vide.",
  bad_quantity: "Une quantité n'est pas valable pour son unité.",
  product_unknown: "Un produit est introuvable.",
  forbidden: "Cette action est réservée à un administrateur.",
};

export const NO_CONNECTION = "Pas de connexion. Réessayez quand le réseau est revenu.";
export const SOMETHING_WRONG = "Un problème est survenu. Réessayez dans quelques instants.";

export function userMessage(e: unknown, fallback = SOMETHING_WRONG): string {
  if (e instanceof NetworkError) return NO_CONNECTION;
  if (e instanceof ApiError) {
    const known = BY_CODE[e.code];
    if (known) return known;
    if (e.status === 401) return BY_CODE.unauthenticated!;
    if (e.status === 403) return "Cette action n'est pas autorisée avec votre profil.";
    if (e.status === 404) return "Cet élément n'existe plus. Actualisez puis réessayez.";
    if (e.status === 429) return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
    if (e.status === 400) return "Vérifiez les champs saisis, puis réessayez.";
  }
  return fallback;
}
