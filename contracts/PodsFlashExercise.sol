// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./interface/IPodOption.sol";
import "./interface/ISushiswapV2Factory.sol";
import "./interface/ISushiswapV2Pair.sol";
import "./libraries/SafeMath.sol";
import "./libraries/UniswapV2Library.sol";

import "hardhat/console.sol";

contract PodsFlashExercise {
    using SafeMathUniswap for uint256;

    ISushiswapV2Factory public sushiswapV2Factory;
    address internal flashSwapCaller;

    constructor(address _sushiswapV2Factory) public {
        require(
            _sushiswapV2Factory != address(0),
            "PFE/null-sushiswap-v2-factory"
        );
        sushiswapV2Factory = ISushiswapV2Factory(_sushiswapV2Factory);
    }

    function uniswapV2Call(
        address _caller,
        uint256,
        uint256,
        bytes calldata _data
    ) external {
        require(_caller == address(this), "PFE/invalid-swap-caller");
        require(msg.sender == flashSwapCaller, "PFE/invalid-callback-caller");

        (
            address user,
            address _option,
            uint256 optionType,
            uint256 optionAmount,
            uint256 amountToSettleOption,
            uint256 flashDebt
        ) = abi.decode(
                _data,
                (address, address, uint256, uint256, uint256, uint256)
            );

        IERC20 receivedAsset = optionType == 1
            ? IERC20(IPodOption(_option).underlyingAsset())
            : IERC20(IPodOption(_option).strikeAsset());
        IERC20 providedAsset = optionType == 0
            ? IERC20(IPodOption(_option).underlyingAsset())
            : IERC20(IPodOption(_option).strikeAsset());
        IPodOption(_option).transferFrom(user, address(this), optionAmount);
        providedAsset.approve(_option, amountToSettleOption);
        IPodOption(_option).exercise(optionAmount);
        receivedAsset.transfer(msg.sender, flashDebt);
        providedAsset.transfer(user, providedAsset.balanceOf(address(this)));
    }

    function _exerciseCall(
        IPodOption _option,
        uint256 _amount,
        uint256 _min
    ) internal {
        ISushiswapV2Pair sushiswapV2Pool = ISushiswapV2Pair(
            sushiswapV2Factory.getPair(
                _option.underlyingAsset(),
                _option.strikeAsset()
            )
        );

        require(
            address(sushiswapV2Pool) != address(0),
            "PFE/no-sushi-pool-available"
        );
        (uint128 _reserve0, uint128 _reserve1, ) = sushiswapV2Pool
            .getReserves();
        flashSwapCaller = address(sushiswapV2Pool);
        if (sushiswapV2Pool.token0() == _option.strikeAsset()) {
            uint256 flashBorrow = UniswapV2Library.getAmountOut(
                _amount,
                _reserve1,
                _reserve0
            );
            bytes memory forwardedData = abi.encode(
                msg.sender, // Address getting the profits
                address(_option), // Address of the option
                1, // Option Type (CALL)
                _amount, // Option Amount
                _option.strikeToTransfer(_amount), // Amount of Strike Asset to send to the option for exercising
                _amount // Amount of Underlying Asset to send back to the Sushi Pair
            );
            require(flashBorrow > _min, "PFE/slippage-too-high");
            sushiswapV2Pool.swap(flashBorrow, 0, address(this), forwardedData);
        } else {
            uint256 flashBorrow = UniswapV2Library.getAmountOut(
                _amount,
                _reserve0,
                _reserve1
            );
            bytes memory forwardedData = abi.encode(
                msg.sender, // Address getting the profits
                address(_option), // Address of the option
                1, // Option Type (CALL)
                _amount, // Option Amount
                _option.strikeToTransfer(_amount), // Amount of Strike Asset to send to the option for exercising
                _amount // Amount of Underlying Asset to send back to the Sushi Pair
            );
            require(flashBorrow > _min, "PFE/slippage-too-high");
            sushiswapV2Pool.swap(0, flashBorrow, address(this), forwardedData);
        }
        flashSwapCaller = address(0);
    }

    function _exercisePut(
        IPodOption _option,
        uint256 _amount,
        uint256 _min
    ) internal {
        ISushiswapV2Pair sushiswapV2Pool = ISushiswapV2Pair(
            sushiswapV2Factory.getPair(
                _option.underlyingAsset(),
                _option.strikeAsset()
            )
        );

        require(
            address(sushiswapV2Pool) != address(0),
            "PFE/no-sushi-pool-available"
        );
        (uint128 _reserve0, uint128 _reserve1, ) = sushiswapV2Pool
            .getReserves();

        uint256 strikeToTransfer = _option.strikeToTransfer(_amount);
        flashSwapCaller = address(sushiswapV2Pool);
        if (sushiswapV2Pool.token0() == _option.strikeAsset()) {
            uint256 flashBorrow = UniswapV2Library.getAmountOut(
                strikeToTransfer,
                _reserve0,
                _reserve1
            );
            bytes memory forwardedData = abi.encode(
                msg.sender, // Address getting the profits
                address(_option), // Address of the option
                0, // Option Type (PUT)
                _amount, // Option Amount
                _amount, // Amount of Underlying Asset to send to the option for exercising
                strikeToTransfer // Amount of Strike Asset to send back to the Sushi Pair
            );
            require(flashBorrow > _min, "PFE/slippage-too-high");
            sushiswapV2Pool.swap(0, flashBorrow, address(this), forwardedData);
        } else {
            uint256 flashBorrow = UniswapV2Library.getAmountOut(
                strikeToTransfer,
                _reserve1,
                _reserve0
            );
            bytes memory forwardedData = abi.encode(
                msg.sender, // Address getting the profits
                address(_option), // Address of the option
                0, // Option Type (PUT)
                _amount, // Option Amount
                _amount, // Amount of Underlying Asset to send to the option for exercising
                strikeToTransfer // Amount of Strike Asset to send back to the Sushi Pair
            );
            require(flashBorrow > _min, "PFE/slippage-too-high");
            sushiswapV2Pool.swap(flashBorrow, 0, address(this), forwardedData);
        }
        flashSwapCaller = address(0);
    }

    function flashExercise(
        address _option,
        uint256 _amount,
        uint256 _min
    ) external {
        require(
            IPodOption(_option).isExerciseWindow(),
            "PFE/not-exercise-window"
        );
        uint256 optionType = IPodOption(_option).optionType();
        if (optionType == 0) {
            // PUT
            _exercisePut(IPodOption(_option), _amount, _min);
        } else {
            // should be CALL
            _exerciseCall(IPodOption(_option), _amount, _min);
        }
    }
}
