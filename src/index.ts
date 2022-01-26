import { CoinGecko } from "./api/coingecko";
import { Router } from "./api/oneinch";
import { Wallet } from "./api/wallet";
import { Connect } from "./redis";
import { Args } from "./utils/flags";
import { PrepareForSwap } from "./utils/prepare";
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

    const routerAddress = await router.GetContractAddress();
    const tokens = await router.GetSupportedTokens();
    const stableTokenContractAddress =
      tokens.find((token) => token.symbol === Args.stableToken)?.address || "";
    const targetTokenContractAddress =
      tokens.find((token) => token.symbol === Args.targetToken)?.address || "";
    if (
      stableTokenContractAddress === "" ||
      targetTokenContractAddress === ""
    ) {
      throw new Error("tokenContractAddress cannot be empty");
    }

    while (true) {
      try {
        console.log(`\n\n${new Date()}\n`);
        console.log(`Wallet Address: ${wallet.Address}`);
        console.log(`Chain ID: ${wallet.ChainID}`);
        console.log(`Router Contract Address: ${routerAddress}`);
        console.log(
          `Stable Token Contract Address (${Args.stableToken}): ${stableTokenContractAddress}`
        );
        console.log(
          `Target Token Contract Address (${Args.targetToken}): ${targetTokenContractAddress}`
        );

        const stableTokenBalance = await wallet.GetTokenBalance(
          stableTokenContractAddress
        );
        const targetTokenBalance = await wallet.GetTokenBalance(
          targetTokenContractAddress
        );

        if (
          stableTokenBalance !== BigInt(0) &&
          targetTokenBalance === BigInt(0)
        ) {
          currentStatus = "WAITING_TO_BUY";
        }
        if (
          stableTokenBalance === BigInt(0) &&
          targetTokenBalance !== BigInt(0)
        ) {
          currentStatus = "WAITING_TO_SELL";
        }

        console.log(`Current Status: ${currentStatus}`);

        const stableCoinID = await CoinGecko.GetCoinID(Args.stableToken);
        const targetCoinID = await CoinGecko.GetCoinID(Args.targetToken);
        const stableTokenCurrentPrice = await CoinGecko.GetCoinPrice(
          stableCoinID
        );
        const targetTokenCurrentPrice = await CoinGecko.GetCoinPrice(
          targetCoinID
        );

        if (currentStatus === "WAITING_TO_BUY") {
          const buyLimitPrice =
            Number(
              await redis.hGet(
                `${Args.stableToken}_${Args.targetToken}`,
                "BuyLimitPrice"
              )
            ) || 0;

          const params = {
            fromTokenAddress: stableTokenContractAddress,
            toTokenAddress: targetTokenContractAddress,
            amount: stableTokenBalance.toString(),
          };
          const quoteResponseDto = await router.GetQuote(params);
          const currentPortfolioValue =
            (Number(stableTokenBalance) /
              Math.pow(10, quoteResponseDto.fromToken.decimals)) *
            stableTokenCurrentPrice;
          const toTokenAmount =
            Number(quoteResponseDto.toTokenAmount) /
            Math.pow(10, quoteResponseDto.toToken.decimals);
          const toTokenValue = toTokenAmount * targetTokenCurrentPrice;
          const actualSlippage =
            ((currentPortfolioValue - toTokenValue) * 100) /
            currentPortfolioValue;

          if (buyLimitPrice >= targetTokenCurrentPrice) {
            if (actualSlippage <= Args.slippagePercent) {
              console.log(
                `BUY (Current Price: $${targetTokenCurrentPrice}, Buy Limit: $${buyLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${
                  Args.slippagePercent
                }%, Current Portfolio Value: $${currentPortfolioValue}, Potential Return: ${toTokenAmount} ${
                  quoteResponseDto.toToken.symbol
                })`
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
                  (Args.profitPercent / 100 + 1) * targetTokenCurrentPrice
                );
                await redis.hSet(
                  `${Args.stableToken}_${Args.targetToken}`,
                  "StopLimitPrice",
                  (1 - Args.stopLossPercent / 100) * targetTokenCurrentPrice
                );
                currentStatus = "WAITING_TO_SELL";
              } catch (error) {
                console.error(error);
                process.exit(1);
              }
            } else {
              console.log(
                `HODL (Current Price: $${targetTokenCurrentPrice}, Buy Limit: $${buyLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${
                  Args.slippagePercent
                }%, Current Portfolio Value: $${currentPortfolioValue}, Potential Return: ${toTokenAmount} ${
                  quoteResponseDto.toToken.symbol
                })`
              );
            }
          } else {
            console.log(
              `HODL (Current Price: $${targetTokenCurrentPrice}, Buy Limit: $${buyLimitPrice}, Slippage Allowed: +${Args.slippagePercent}%, Current Portfolio Value: $${currentPortfolioValue}, Potential Return: ${toTokenAmount} ${quoteResponseDto.toToken.symbol})`
            );
          }
        } else if (currentStatus === "WAITING_TO_SELL") {
          const stopLimitPrice =
            Number(
              await redis.hGet(
                `${Args.stableToken}_${Args.targetToken}`,
                "StopLimitPrice"
              )
            ) || 0;

          const sellLimitPrice =
            Number(
              await redis.hGet(
                `${Args.stableToken}_${Args.targetToken}`,
                "SellLimitPrice"
              )
            ) || 9999999999;

          const params = {
            fromTokenAddress: targetTokenContractAddress,
            toTokenAddress: stableTokenContractAddress,
            amount: targetTokenBalance.toString(),
          };
          const quoteResponseDto = await router.GetQuote(params);

          const currentPortfolioValue =
            (Number(targetTokenBalance) /
              Math.pow(10, quoteResponseDto.fromToken.decimals)) *
            targetTokenCurrentPrice;
          const toTokenAmount =
            Number(quoteResponseDto.toTokenAmount) /
            Math.pow(10, quoteResponseDto.toToken.decimals);
          const toTokenValue = toTokenAmount * stableTokenCurrentPrice;
          const actualSlippage =
            ((currentPortfolioValue - toTokenValue) * 100) /
            currentPortfolioValue;

          if (
            targetTokenCurrentPrice >= sellLimitPrice ||
            stopLimitPrice >= targetTokenCurrentPrice
          ) {
            if (actualSlippage <= Args.slippagePercent) {
              console.log(
                `SELL (Current Price: $${targetTokenCurrentPrice}, Sell Limit: $${sellLimitPrice}, Stop Limit: $${stopLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${
                  Args.slippagePercent
                }%, Current Portfolio Value: $${currentPortfolioValue}, Potential Return: ${toTokenAmount} ${
                  quoteResponseDto.toToken.symbol
                })`
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
                `HODL (Current Price: $${targetTokenCurrentPrice}, Sell Limit: $${sellLimitPrice}, Stop Limit: $${stopLimitPrice}, Slippage: ${actualSlippage.toFixed(
                  2
                )}%, Slippage Allowed: +${
                  Args.slippagePercent
                }%, Current Portfolio Value: $${currentPortfolioValue}, Potential Return: ${toTokenAmount} ${
                  quoteResponseDto.toToken.symbol
                })`
              );
            }
          } else {
            console.log(
              `HODL (Current Price: $${targetTokenCurrentPrice}, Sell Limit: $${sellLimitPrice}, Stop Limit: $${stopLimitPrice}, Slippage Allowed: +${Args.slippagePercent}%, Current Portfolio Value: $${currentPortfolioValue}, Potential Return: ${toTokenAmount} ${quoteResponseDto.toToken.symbol})`
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
