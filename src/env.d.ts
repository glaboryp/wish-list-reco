/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly POSTGRES_URL: string;
  readonly BLOB_READ_WRITE_TOKEN?: string;
  readonly ENCRYPTION_KEY: string;
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASSWORD?: string;
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SESSION_SECRET: string;
  readonly SUPERADMIN_EMAIL: string;
  readonly PUBLIC_FIREBASE_API_KEY: string;
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  readonly PUBLIC_FIREBASE_PROJECT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
