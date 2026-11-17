import { createElement, type HTMLAttributes } from "react";
import "./shared-message-gradient.js";

export function SharedMessageGradient({
  active,
  className,
  children,
  ...attributes
}: HTMLAttributes<HTMLElement> & { active: boolean }) {
  return createElement(
    "shared-message-gradient",
    {
      ...attributes,
      active: active ? "" : undefined,
      class: className,
    },
    children,
  );
}
