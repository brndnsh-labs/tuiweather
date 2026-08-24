import { createContext, useContext } from "react";
import { type Palette, resolvePalette } from "./palette";

export const ThemeContext = createContext<Palette>(resolvePalette("auto", true));

export function usePalette(): Palette {
  return useContext(ThemeContext);
}
