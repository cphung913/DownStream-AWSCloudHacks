/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPSYNC_URL?: string;
  readonly VITE_APPSYNC_API_KEY?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_LOCATION_MAP?: string;
  readonly VITE_LOCATION_PLACES?: string;
  readonly VITE_LOCATION_API_KEY?: string;
  readonly VITE_CDN_URL?: string;
  readonly VITE_STATE_MACHINE_ARN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
