import { useState } from "react";
import { CATEGORY_EMOJI } from "../categories";

export function Thumb({ photoUrl, category }: { photoUrl: string | null; category: string }) {
  const [broken, setBroken] = useState(false);
  return photoUrl && !broken ? (
    <img className="thumb" src={photoUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
  ) : (
    <span className="thumb thumb--empty" aria-hidden="true">{CATEGORY_EMOJI[category] ?? "•"}</span>
  );
}
