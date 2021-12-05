# Pods Flash Exercise

## Purpose

The goal of this utility contract is to allow anyone to exercise its ITM Pods Option without providing the required settlement asset. It leverages Flash Swaps from UniswapV2 to borrow the settlement amount (+ profit) and pay back once the option is exercised.

## Advantages

- Pods uses no oracles to determine if an option is ITM or OTM
- No settlement asset required prior to exercising

## Drawbacks

- Slippage during the Flash Swap

## Usage

#### `function flashExercise(address _uniswapV2Factory, address _option, uint256 _amount, uint256 _min) external`

Tries to perform a Flash Swap to exercise the provided option. The call revert if the total borrowed amount is lower than `_min`.

#### `function getEstimatedProfits(address _uniswapV2Factory, address _option, uint256 _amount) external view returns (uint256, uint256)`

Estimated the profit from exercising the options with current state. Returns the amount that will be borrowed (can be used to adjust the `_min` slippage parameter when exercising) and the profits that are going to be sent to the user.

#### `function getProfitsAsset(address _option) external view returns (address)`

Returns the address of the profit asset.
