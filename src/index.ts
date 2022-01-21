import { CoinGecko } from "./api/coingecko";
import { Router } from "./api/oneinch";
import { Wallet } from "./api/wallet";
import { Connect } from "./redis";
import { Approve } from "./utils/approve";
import { Args } from "./utils/flags";
import { PrepareForSwap } from "./utils/prepare";
import { Swap } from "./utils/swap";
import { Wait } from "./utils/wait";

(async () => {
  try {
    // Connect to redis
    const redis = await Connect(Args.redisAddress);

    // initialize wallet
    const wallet = new Wallet(Args.publicKey, Args.privateKey, Args.chainId);

    // Initialize router
    const router = new Router(Args.chainId);

    let currentStatus = "UNKNOWN";

    while (true) {
      try {
        const routerAddress = await router.GetContractAddress();
        console.log(`Wallet Address: ${wallet.Address}`);
        console.log(`Chain ID: ${wallet.ChainID}`);
        console.log(`Router Contract Address: ${routerAddress}`);

        const tokens = await router.GetSupportedTokens();
        const stableTokenContractAddress =
          tokens.find((token) => token.symbol === Args.stableToken)?.address ||
          "";
        const targetTokenContractAddress =
          tokens.find((token) => token.symbol === Args.targetToken)?.address ||
          "";
        if (
          stableTokenContractAddress === "" ||
          targetTokenContractAddress === ""
        ) {
          throw "tokenContractAddress cannot be empty";
        }

        console.log(`Stable Token Contract Address (${Args.stableToken}): ${stableTokenContractAddress}`);
        console.log(`Target Token Contract Address (${Args.targetToken}): ${targetTokenContractAddress}`);

        const stableTokenBalance = await wallet.GetTokenBalance(
          stableTokenContractAddress
        );
        const targetTokenBalance = await wallet.GetTokenBalance(
          targetTokenContractAddress
        );

        if (stableTokenBalance !== 0 && targetTokenBalance === 0) {
          currentStatus = "WAITING_TO_BUY";
        }
        if (stableTokenBalance === 0 && targetTokenBalance !== 0) {
          currentStatus = "WAITING_TO_SELL";
        }

        const targetCoinID = await CoinGecko.GetCoinID(Args.targetToken);
        const currentPrice = await CoinGecko.GetCoinPrice(targetCoinID);

        if (currentStatus === "WAITING_TO_BUY") {
          const buyLimitPrice =
            (await redis.hGet(
              `${Args.stableToken}_${Args.targetToken}`,
              "BuyLimitPrice"
            )) || 0;

          if (buyLimitPrice >= currentPrice) {
            const params = {
              fromTokenAddress: stableTokenContractAddress,
              toTokenAddress: targetTokenContractAddress,
              amount: BigInt(stableTokenBalance).toString(),
            };
            const quoteResponseDto = await router.GetQuote(params);
            const maxToTokenAmount =
              stableTokenBalance /
              Math.pow(10, quoteResponseDto.fromToken.decimals) /
              currentPrice;
            const minToTokenAmount =
              quoteResponseDto.toTokenAmount /
              Math.pow(10, quoteResponseDto.toToken.decimals);
            const actualSlippage =
              ((maxToTokenAmount - minToTokenAmount) * 100) / maxToTokenAmount;

            if (actualSlippage <= Args.slippagePercent) {
              console.log(
                `BUY ${minToTokenAmount} ${
                  quoteResponseDto.toToken.symbol
                } (Current Price: $${currentPrice}, Buy Limit: $${buyLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${Args.slippagePercent}%)`
              );
              try {
                await PrepareForSwap(
                  router,
                  wallet,
                  stableTokenContractAddress,
                  stableTokenBalance,
                  targetTokenContractAddress
                );
                await redis.hSet(
                  `${Args.stableToken}_${Args.targetToken}`,
                  "SellLimitPrice",
                  ((Args.profitPercent / 100) + 1) * currentPrice
                );
                await redis.hSet(
                  `${Args.stableToken}_${Args.targetToken}`,
                  "StopLimitPrice",
                  (1 - (Args.stopLossPercent / 100)) * currentPrice
                );
                currentStatus = "WAITING_TO_SELL";
              } catch (error) {
                console.error(error);
                process.exit(1);
              }
            } else {
              console.log(
                `HODL (Current Price: $${currentPrice}, Buy Limit: $${buyLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${Args.slippagePercent}%)`
              );
            }
          } else {
            console.log(
              `HODL (Current Price: $${currentPrice}, Buy Limit: $${buyLimitPrice}, Slippage Allowed: +${Args.slippagePercent}%)`
            );
          }
        } else if (currentStatus === "WAITING_TO_SELL") {
          const stopLimitPrice =
            (await redis.hGet(
              `${Args.stableToken}_${Args.targetToken}`,
              "StopLimitPrice"
            )) || 0;

          const sellLimitPrice =
            (await redis.hGet(
              `${Args.stableToken}_${Args.targetToken}`,
              "SellLimitPrice"
            )) || 9999999999;

          if (
            currentPrice >= sellLimitPrice ||
            stopLimitPrice >= currentPrice
          ) {
            const params = {
              fromTokenAddress: targetTokenContractAddress,
              toTokenAddress: stableTokenContractAddress,
              amount: BigInt(targetTokenBalance).toString(),
            };
            const quoteResponseDto = await router.GetQuote(params);
            const maxToTokenAmount =
              (targetTokenBalance /
                Math.pow(10, quoteResponseDto.fromToken.decimals)) *
              currentPrice;
            const minToTokenAmount =
              quoteResponseDto.toTokenAmount /
              Math.pow(10, quoteResponseDto.toToken.decimals);
            const actualSlippage =
              ((maxToTokenAmount - minToTokenAmount) * 100) / maxToTokenAmount;

            if (actualSlippage <= Args.slippagePercent) {
              console.log(
                `SELL (Current Price: $${currentPrice}, Sell Limit: $${sellLimitPrice}, Stop Limit: $${stopLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${Args.slippagePercent}%)`
              );
              try {
                await PrepareForSwap(
                  router,
                  wallet,
                  targetTokenContractAddress,
                  targetTokenBalance,
                  stableTokenContractAddress
                );
                await redis.hSet(
                  `${Args.stableToken}_${Args.targetToken}`,
                  "BuyLimitPrice",
                  0
                );
                await redis.hSet(
                  `${Args.stableToken}_${Args.targetToken}`,
                  "StopLimitPrice",
                  0
                );
                await redis.hSet(
                  `${Args.stableToken}_${Args.targetToken}`,
                  "SellLimitPrice",
                  9999999999
                );
                currentStatus = "WAITING_TO_BUY";
              } catch (error) {
                console.error(error);
                process.exit(1);
              }
            } else {
              console.log(
                `HODL (Current Price: $${currentPrice}, Sell Limit: $${sellLimitPrice}, Stop Limit: $${stopLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${Args.slippagePercent}%)`
              );
            }
          } else {
            console.log(
              `HODL (Current Price: $${currentPrice}, Sell Limit: $${sellLimitPrice}, Stop Limit: $${stopLimitPrice}, Slippage Allowed: +${Args.slippagePercent}%)`
            );
          }
        } else {
          console.log(`Current Status: ${currentStatus}. Nothing to do`);
        }
      } catch (error) {
        console.error(error);
      }
      await Wait(60);
    }
    await redis.disconnect();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
