import { invoke } from "@tauri-apps/api/core";

export function useTauriCommand() {
  return { invoke };
}
