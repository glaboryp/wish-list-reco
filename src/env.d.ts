/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PAYPAL_CLIENT_ID: string;
  readonly PAYPAL_APP_SECRET: string;
  readonly PUBLIC_PAYPAL_ENVIRONMENT: 'sandbox' | 'live';
  readonly PUBLIC_PAYPAL_CLIENT_ID: string;
  readonly POSTGRES_URL: string;
  readonly BLOB_READ_WRITE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
