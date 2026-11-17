import { createElement, type ReactNode } from "react";
import "./shared-message-gradient.js";

export function SharedMessageGradient({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return createElement(
    "shared-message-gradient",
    {
      active: active ? "" : undefined,
      class: className,
    },
    children,
  );
}
