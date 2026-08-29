import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { WeatherStore } from "../../app/store";
import type { TuiConfig } from "../../lib/config/schema";
import { usePalette } from "../../theme/tokens";
import { buildLocationEntry, LocationPicker } from "../search/SearchOverlay";

type Step = "welcome" | "units" | "location";

interface FirstRunProps {
  store: WeatherStore;
  width: number;
  height: number;
  quit(): void;
}

function truncateTo(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function FirstRun({ store, width, height, quit }: FirstRunProps) {
  const palette = usePalette();
  const configUnits = store((s) => s.config.units);
  const searchLocations = store((s) => s.searchLocations);
  const [step, setStep] = useState<Step>("welcome");
  const [units, setUnits] = useState<TuiConfig["units"]>(configUnits);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  useKeyboard((key) => {
    if (width < 32) {
      if (key.name === "q") quit();
      return;
    }
    if (step === "location") return;
    if (key.name === "q") {
      quit();
      return;
    }
    if (step === "welcome") {
      if (key.name === "return" || key.name === "enter" || key.name === "escape") {
        setStep("units");
      }
      return;
    }
    if (key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") {
      setUnits((current) => (current === "imperial" ? "metric" : "imperial"));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      setStep("location");
      return;
    }
    if (key.name === "escape") setStep("welcome");
  });

  if (width < 32) {
    return (
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <text fg={palette.fg}>
          {truncateTo("tuiweather · resize to 32+ cols · q quit", Math.max(1, width))}
        </text>
      </box>
    );
  }

  if (step === "location") {
    return (
      <LocationPicker
        searchLocations={searchLocations}
        width={width}
        height={height}
        title="3/3 · find your first location"
        footer={saveError ? "enter retry · esc back · ctrl+c quit" : "enter start · ↑↓ · esc back"}
        busy={saving}
        actionError={saveError}
        onQueryChange={() => setSaveError(undefined)}
        onCancel={() => {
          if (!saving) setStep("units");
        }}
        onSelect={(result) => {
          if (saving) return;
          setSaving(true);
          setSaveError(undefined);
          const entry = buildLocationEntry(result, []);
          void store
            .getState()
            .completeOnboarding(entry, units)
            .then((completed) => {
              if (!completed) {
                setSaveError(store.getState().lastActionError ?? "could not save config");
                setSaving(false);
              }
            });
        }}
      />
    );
  }

  const panelWidth = Math.min(64, width);
  const innerWidth = Math.max(1, panelWidth - 2);
  if (step === "welcome") {
    return (
      <box width="100%" height="100%" justifyContent="center" alignItems="center">
        <box
          width={panelWidth}
          border
          borderColor={palette.accent}
          backgroundColor={palette.surface}
          title="1/3 · welcome to tuiweather"
          flexDirection="column"
          paddingX={1}
          gap={1}
        >
          <text fg={palette.fg} bg={palette.surface}>
            {truncateTo("Live weather, rain timing, and forecasts in your terminal.", innerWidth)}
          </text>
          {width >= 48 ? (
            <text fg={palette.fgDim} bg={palette.surface}>
              {truncateTo("/ search · r refresh · u units · l locations", innerWidth)}
            </text>
          ) : (
            <text fg={palette.fgDim} bg={palette.surface}>
              {truncateTo("/ search · r refresh · u units", innerWidth)}
            </text>
          )}
          <text fg={palette.fgDim} bg={palette.surface}>
            {truncateTo("? help · q quit", innerWidth)}
          </text>
          <text fg={palette.accent} bg={palette.surface}>
            {truncateTo("enter continue · esc skip tour · q quit", innerWidth)}
          </text>
        </box>
      </box>
    );
  }

  return (
    <box width="100%" height="100%" justifyContent="center" alignItems="center">
      <box
        width={panelWidth}
        border
        borderColor={palette.accent}
        backgroundColor={palette.surface}
        title="2/3 · choose units"
        flexDirection="column"
        paddingX={1}
        gap={1}
      >
        <text fg={units === "imperial" ? palette.accent : palette.fg} bg={palette.surface}>
          {units === "imperial" ? "›" : " "} Fahrenheit · mph
        </text>
        <text fg={units === "metric" ? palette.accent : palette.fg} bg={palette.surface}>
          {units === "metric" ? "›" : " "} Celsius · km/h
        </text>
        <text fg={palette.fgDim} bg={palette.surface}>
          {truncateTo("↑↓ choose · enter continue · esc back · q quit", innerWidth)}
        </text>
      </box>
    </box>
  );
}
