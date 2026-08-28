import { createContext, useContext } from "react";
import { buildPalette, type Palette } from "./palette";

export const ThemeContext = createContext<Palette>(buildPalette("auto", true, "dark", null));

export function usePalette(): Palette {
  return useContext(ThemeContext);
}
