import type { Accent, AccentFamily } from "../../domain/validation.js";

export type AccentStyle = "plain" | "gradient";

export function storedAccent(value: Accent): {
  accent: AccentFamily;
  accent_style: AccentStyle;
} {
  const gradient = value.endsWith("-gradient");
  const family = gradient ? value.slice(0, -"-gradient".length) : value;
  return {
    accent: family as AccentFamily,
    accent_style: gradient ? "gradient" : "plain",
  };
}
