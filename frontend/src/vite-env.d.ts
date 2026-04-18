/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPSYNC_ENDPOINT?: string;
  readonly VITE_ALS_MAP_NAME?: string;
  readonly VITE_ALS_API_KEY?: string;
  readonly VITE_RIVER_GRAPH_CDN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
