import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// Placeholder: the real popup arrives in Task 8.
function Popup() {
  return <main className="w-80 p-4 text-base font-medium">Capture for…</main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
