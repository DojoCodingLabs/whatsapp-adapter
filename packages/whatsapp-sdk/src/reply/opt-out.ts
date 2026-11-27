// Free-text opt-out keyword detection ("stop", "baja", "no me
// escriban"). Ported from doji-agent `src/whatsapp/optout.ts`
// (regexes unchanged). Meta's `user_preferences` webhook stays
// authoritative for marketing opt-out; this is the keyword fallback
// for people who just type it. No acknowledgement copy here —
// consumers own their tone.

const EXACT =
  /^(stop|stopp|para ya|baja|darme de baja|dar de baja|unsubscribe|unsub|cancelar suscripcion|desuscribir(me)?|remove me|opt out)$/;
const ES =
  /\b(no me (vuelva[ns]? a )?(escrib|contact|mand|envi)\w*|(de[mn]e|dame|denme|quiero( la)?|darme( de)?) (de )?baja|deje[ns]? de (escribir|enviar|mandar|contactar)\w*|deja de (escribir|enviar|mandar)\w*|(borre|elimine)[ns]? mi numero|no (quiero|deseo) recibir (mas )?(mensajes|informacion|promociones|publicidad|notificaciones|ofertas))\b/;
/**
 * Double negatives ask to KEEP receiving: "no deje de enviarme
 * información", "nunca dejen de escribirme". Checked before {@link ES}.
 */
const NEGATED_STOP = /\b(no|nunca|jamas) (me )?dej[ae][ns]? de\b/;
/** Courtesy words around a bare keyword ("baja por favor", "STOP, gracias"). */
const POLITE_EDGES =
  /^(por favor|porfa|please) | (por favor|porfa|gracias|muchas gracias|please|thanks|thank you)$/g;
const EN =
  /\b(stop (messaging|texting|writing|contacting)( me)?|do ?n[o']?t (text|message|contact|write( to)?) me|unsubscribe|remove me)\b/;

/** Longest normalized message still considered (longer text is a story, not a request). */
export const OPT_OUT_MAX_LENGTH = 80;

function normalize(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPoliteEdges(t: string): string {
  let prev: string;
  let out = t;
  do {
    prev = out;
    out = out.replace(POLITE_EDGES, "").trim();
  } while (out !== prev && out.length > 0);
  return out;
}

/**
 * Detect a typed opt-out request. Returns the language of the
 * matched pattern (`"es"` | `"en"`) so the consumer can pick its own
 * acknowledgement, or `null` when the text is not an opt-out.
 *
 * Only short messages count (≤ {@link OPT_OUT_MAX_LENGTH} characters
 * after normalizing accents, case and punctuation), so someone
 * quoting "no me escriban" inside a longer message is not opted
 * out. A bare `STOP` / `baja` is classified `"es"` (common in
 * Spanish chats); English phrases ("stop messaging me",
 * "unsubscribe", "remove me") are `"en"`.
 *
 * Polarity: a negated stop ("no deje de enviarme información") is
 * NOT an opt-out, and "baja" only counts as a bare keyword or in
 * "dar(me) de baja" form, so "baja de precio" is not one either.
 * Courtesy words at the edges ("baja por favor") are ignored.
 */
export function detectOptOut(text: string): "es" | "en" | null {
  const normalized = normalize(text);
  if (!normalized || normalized.length > OPT_OUT_MAX_LENGTH) return null;
  if (NEGATED_STOP.test(normalized)) return null;
  const t = stripPoliteEdges(normalized);
  if (EN.test(t) || /^(unsub|opt out)$/.test(t)) return "en";
  if (EXACT.test(t) || ES.test(t)) return "es";
  return null;
}
