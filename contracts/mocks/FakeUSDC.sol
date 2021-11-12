// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FakeUSDC is ERC20("Fake USD Coin", "fake(USDC)") {
    function mint(address _to, uint256 _amount) external {
        ERC20._mint(_to, _amount);
    }
}
