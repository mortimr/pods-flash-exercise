// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPodOption is IERC20 {
    function strikeToTransfer(uint256 amountOfOptions)
        external
        view
        returns (uint256);

    function optionType() external view returns (uint256);

    function strikeAsset() external view returns (address);

    function underlyingAsset() external view returns (address);

    function isExerciseWindow() external view returns (bool);

    function exercise(uint256 amountOfOptions) external;

    function configurationManager() external view returns (address);
}
