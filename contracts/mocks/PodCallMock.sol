// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import "@pods/contracts/contracts/options/PodCall.sol";

contract PodCallMock is PodCall {
    constructor(
        string memory name,
        string memory symbol,
        IPodOption.ExerciseType exerciseType,
        address underlyingAsset,
        address strikeAsset,
        uint256 strikePrice,
        uint256 expiration,
        uint256 exerciseWindowSize,
        IConfigurationManager configurationManager
    )
        public
        PodCall(
            name,
            symbol,
            exerciseType,
            underlyingAsset,
            strikeAsset,
            strikePrice,
            expiration,
            exerciseWindowSize,
            configurationManager
        )
    {
        this;
    }
}
