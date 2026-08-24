import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

function App() {
  return (
    <box flexDirection="column" padding={1} gap={1}>
      <text fg="#7AA2F7">tuiweather</text>
      <text fg="#565F89">scaffold ok — ctrl-c to exit</text>
    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: true });
createRoot(renderer).render(<App />);
