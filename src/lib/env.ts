// Centralised env access. Server-only values throw loudly when missing so a
// misconfigured deploy fails at the first request instead of silently misbehaving.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
};

export const serverEnv = {
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
  },
  get secretsKey() {
    return required("SECRETS_ENCRYPTION_KEY", process.env.SECRETS_ENCRYPTION_KEY);
  },
  get anthropicKey() {
    return process.env.ANTHROPIC_API_KEY || null;
  },
  get cronSecret() {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
  get demoPassword() {
    return required("DEMO_USER_PASSWORD", process.env.DEMO_USER_PASSWORD);
  },
};
