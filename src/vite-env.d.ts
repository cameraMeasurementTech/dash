/// <reference types="vite/client" />

/** Augment Vite’s ImportMetaEnv — do not redeclare `ImportMeta` or `env` narrows and hides `DEV` / `MODE`. */
interface ImportMetaEnv {
  /** Same-origin path only (e.g. `/api/v1`). Absolute URLs are ignored at runtime. */
  readonly VITE_API_BASE_URL?: string;
  /** Same-origin path only (e.g. `/affine-io`). Absolute URLs are ignored at runtime. */
  readonly VITE_AFFINE_SCORES_BASE_URL?: string;
  readonly VITE_DEV_PROXY_TARGET?: string;
}
