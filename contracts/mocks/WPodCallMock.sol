// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import "@pods/contracts/contracts/options/WPodCall.sol";

contract WPodCallMock is WPodCall {
    constructor(
        string memory name,
        string memory symbol,
        IPodOption.ExerciseType exerciseType,
        address strikeAsset,
        uint256 strikePrice,
        uint256 expiration,
        uint256 exerciseWindowSize,
        IConfigurationManager configurationManager
    )
        public
        WPodCall(
            name,
            symbol,
            exerciseType,
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
