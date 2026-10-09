import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { appliquerApparenceMemorisee } from "./lib/apparence";
import "./styles/theme.css";

// Avant le premier affichage : le thème et la taille du texte ne changent pas sous les yeux.
appliquerApparenceMemorisee();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
