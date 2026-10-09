export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const invalidCredentials = () =>
  new HttpError(401, "invalid_credentials", "Identifiants invalides ou accès temporairement bloqué");
