declare const __ASTRA_TELEGRAM_CREDENTIALS_URL__: string | undefined;
declare const __ASTRA_TELEGRAM_CREDENTIALS_TOKEN__: string | undefined;

export interface TelegramDeploymentConfig {
  credentialsUrl: string;
  accessToken: string;
}

export function telegramDeploymentConfig(): TelegramDeploymentConfig {
  const bakedUrl = typeof __ASTRA_TELEGRAM_CREDENTIALS_URL__ === "string"
    ? __ASTRA_TELEGRAM_CREDENTIALS_URL__.trim()
    : "";
  const bakedToken = typeof __ASTRA_TELEGRAM_CREDENTIALS_TOKEN__ === "string"
    ? __ASTRA_TELEGRAM_CREDENTIALS_TOKEN__.trim()
    : "";

  return {
    credentialsUrl: bakedUrl || String(process.env.ASTRA_TELEGRAM_CREDENTIALS_URL ?? "").trim(),
    accessToken: bakedToken || String(process.env.ASTRA_TELEGRAM_CREDENTIALS_TOKEN ?? "").trim(),
  };
}
