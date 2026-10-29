import { createContext } from "react";
import { defaultProjectLabels } from "../domain/labels.js";
export const ProjectLabelContext = createContext(defaultProjectLabels());
