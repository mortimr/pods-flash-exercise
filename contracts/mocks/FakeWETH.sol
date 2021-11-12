// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FakeWETH is ERC20("Fake Wrapped Ether", "fake(WETH)") {
    function mint(address _to, uint256 _amount) external {
        ERC20._mint(_to, _amount);
    }
}
