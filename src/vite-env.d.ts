/// <reference types="vite/client" />

/** Augment Vite’s ImportMetaEnv — do not redeclare `ImportMeta` or `env` narrows and hides `DEV` / `MODE`. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_PROXY_TARGET?: string;
  /** Dev only: "true" = browser calls https://api.affine.io directly (may 403 behind WAF). */
  readonly VITE_API_DIRECT?: string;
}
