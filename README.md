# Pods Flash Exercise

## Purpose

The goal of this utility contract is to allow anyone to exercise its ITM Pods Option without providing the required settlement asset. It leverages Flash Swaps from UniswapV2 to borrow the settlement amount (+ profit) and pay back once the option is exercised.

## Advantages

- Pods uses no oracles to determine if an option is ITM or OTM
- No settlement asset required prior to exercising

## Drawbacks

- Slippage during the Flash Swap