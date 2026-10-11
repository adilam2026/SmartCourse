import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api";
import { userMessage } from "./errors";

describe("messages d'erreur affichés", () => {
  it("jamais de message brut du serveur, de statut ou d'infrastructure", () => {
    const raw = [
      new ApiError(500, "internal_error", "connect ECONNREFUSED 10.0.0.1:5432 (HTTP 500) Brevo Railway SQL"),
      new ApiError(400, "bad_request", "body must be object"),
      new ApiError(418, "teapot", "SELECT * FROM profiles"),
      new ApiError(409, "active_exists", "Une liste est déjà en cours (c0ffee00-0000-0000-0000-000000000000)"),
      new Error("TypeError: x is undefined"),
    ];
    for (const e of raw) expect(userMessage(e)).not.toMatch(/ECONN|HTTP|Brevo|Railway|SQL|SELECT|body|TypeError|c0ffee|\b\d{3}\b/i);
  });
  it("chaque erreur propose une suite", () => {
    expect(userMessage(new NetworkError())).toMatch(/Réessayez/);
    expect(userMessage(new ApiError(401, "x", ""))).toMatch(/Reconnectez-vous/);
    expect(userMessage(new ApiError(400, "x", ""))).toMatch(/Vérifiez/);
    expect(userMessage(new ApiError(429, "x", ""))).toMatch(/Patientez/);
    expect(userMessage(new ApiError(500, "x", ""))).toMatch(/Réessayez/);
    expect(userMessage(new ApiError(409, "weak_secret", ""))).toMatch(/trop simple/);
  });
});
