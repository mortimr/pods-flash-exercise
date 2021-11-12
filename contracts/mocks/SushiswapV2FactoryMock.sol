// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@sushiswap/contracts/contracts/uniswapv2/UniswapV2Factory.sol";

contract SushiswapV2FactoryMock is UniswapV2Factory {
    constructor() public UniswapV2Factory(address(0)) {
        this;
    }
}
