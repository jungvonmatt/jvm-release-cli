import type { GitProvider } from "../changelog/types.ts";
import { github } from "./github.ts";
import { gitlab } from "./gitlab.ts";
import type { Provider } from "./types.ts";

export type { Provider, ReleaseDetails } from "./types.ts";
export { github, gitlab };

export const providers: Record<GitProvider, Provider> = { github, gitlab };

export const getProvider = (id: GitProvider): Provider => providers[id];

/** Detects the provider from the remote host. Self-hosted instances may need `gitProvider` in the config. */
export const detectProvider = (host: string): GitProvider | null =>
  Object.values(providers).find((provider) => host.includes(provider.id))?.id ?? null;
