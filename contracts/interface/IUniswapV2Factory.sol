// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IUniswapV2Factory {
    function getPair(address t0, address t1) external view returns (address);
}
