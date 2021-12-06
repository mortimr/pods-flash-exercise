// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IConfigurationManager {
	    function getParameter(bytes32 name) external view returns (uint256);
}