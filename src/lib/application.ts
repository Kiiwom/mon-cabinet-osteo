import { invoke, isTauri } from "@tauri-apps/api/core";

export interface InfosApplication {
  nom: string;
  version: string;
  version_coeur: string;
  /** « windows », « linux » ou « macos ». */
  systeme: string;
  dans_tauri: boolean;
}

/** Dans un simple navigateur (développement de l'interface), le cœur Rust n'est pas joignable. */
export async function lireInfosApplication(): Promise<InfosApplication> {
  if (!isTauri()) {
    return { nom: "Osteosphere", version: "aperçu navigateur", version_coeur: "non chargé", systeme: "navigateur", dans_tauri: false };
  }
  const infos = await invoke<Omit<InfosApplication, "dans_tauri">>("infos_application");
  return { ...infos, dans_tauri: true };
}
