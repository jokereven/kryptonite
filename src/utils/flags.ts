let ENV: any = process.env;
export const Args = {
  publicKey: ENV.PUBLIC_KEY || "",
  privateKey: ENV.PRIVATE_KEY || "",
  mode: ENV.MODE || "MANUAL",
  chatId: ENV.CHAT_ID || "",
  stableToken: ENV.STABLE_TOKEN || "USDC",
  targetToken: ENV.TARGET_TOKEN || "WMATIC",
  stableTokenTickerKraken: ENV.STABLE_TOKEN_TICKER_KRAKEN || "USDCUSD",
  targetTokenTickerKraken: ENV.TARGET_TOKEN_TICKER_KRAKEN || "MATICUSD",
  botToken: ENV.BOT_TOKEN || "",
  password: ENV.PASSWORD || "kryptonite",
  redisAddress: ENV.REDIS_ADDRESS || "",
  chainId: Number(ENV.CHAIN_ID || 137),
  preAuth: ENV.PRE_AUTH ? Boolean(ENV.PRE_AUTH) : false,
  slippagePercent: Number(ENV.SLIPPAGE_PERCENT || 1),
  port: Number(ENV.PORT || 8080),
  trace: ENV.TRACE ? Boolean(ENV.TRACE) : false,
};
