import { createContext } from "react";
export const EXAMPLE_NOTICE =
  "Read-only example. Create a copy to edit messages or open and modify files.";
export const ExampleReadOnlyContext = createContext<(() => void) | undefined>(
  undefined,
);
