// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./interface/IPodOption.sol";
import "./interface/ISushiswapV2Factory.sol";
import "./interface/ISushiswapV2Pair.sol";
import "./libraries/SafeMath.sol";
import "./libraries/UniswapV2Library.sol";

/// @title A Flash Swap exerciser for Pods Finance
/// @author mortimr
/// @notice You can use this contract to exercise an option without providing the required settlement asset
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

    /// @notice Callback called by the Pool during the Flash Swap
    /// @param _caller is the address that triggered the Flash Swap.
    /// @param _data is the encoded payload built before the Flash Swap
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

        // We retrieve the Option from the user. Fails if no approval.
        IPodOption(_option).transferFrom(user, address(this), optionAmount);

        // We approve the settlement asset on the Option
        providedAsset.approve(_option, amountToSettleOption);

        // We call the exercise function
        IPodOption(_option).exercise(optionAmount);

        // We send the retrieved asset to the Pool, completing the Flash Swap
        receivedAsset.transfer(msg.sender, flashDebt);

        // The difference between what was borrowed and what was used to settle the option is the profit, and is sent to the original caller
        providedAsset.transfer(user, providedAsset.balanceOf(address(this)));
    }

    /// @notice Prepares a Flash Swap call to exercise a call option
    /// @param _option Address of the Option
    /// @param _amount Amount of Option to exercise
    /// @param _min Slippage parameter. Ensures that the call won't retrieve less than this amount.
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

        uint256 strikeToTransfer = _option.strikeToTransfer(_amount);

        // Set guard, tells the callback to expect a call from the following address
        flashSwapCaller = address(sushiswapV2Pool);

        // Compute amount to borrow
        uint256 flashBorrow = UniswapV2Library.getAmountOut(
            _amount,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve1
                : _reserve0,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve0
                : _reserve1
        );

        // Build encoded payload
        bytes memory forwardedData = abi.encode(
            msg.sender, // Address getting the profits
            address(_option), // Address of the option
            1, // Option Type (CALL)
            _amount, // Option Amount
            strikeToTransfer, // Amount of Strike Asset to send to the option for exercising
            _amount // Amount of Underlying Asset to send back to the Sushi Pair
        );

        // Perform slippage check
        require(flashBorrow >= _min, "PFE/slippage-too-high");
        require(flashBorrow >= strikeToTransfer, "PFE/borrow-too-low");

        // Call Flash Swap
        sushiswapV2Pool.swap(
            sushiswapV2Pool.token0() == _option.strikeAsset() ? flashBorrow : 0,
            sushiswapV2Pool.token0() == _option.strikeAsset() ? 0 : flashBorrow,
            address(this),
            forwardedData
        );

        // Reset guard
        flashSwapCaller = address(0);
    }

    /// @notice Prepares a Flash Swap call to exercise a put option
    /// @param _option Address of the Option
    /// @param _amount Amount of Option to exercise
    /// @param _min Slippage parameter. Ensures that the call won't retrieve less than this amount.
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

        // Set guard, tells the callback to expect a call from the following address
        flashSwapCaller = address(sushiswapV2Pool);

        // Compute amount to borrow
        uint256 flashBorrow = UniswapV2Library.getAmountOut(
            strikeToTransfer,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve0
                : _reserve1,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve1
                : _reserve0
        );

        // Build encoded payload
        bytes memory forwardedData = abi.encode(
            msg.sender, // Address getting the profits
            address(_option), // Address of the option
            0, // Option Type (PUT)
            _amount, // Option Amount
            _amount, // Amount of Underlying Asset to send to the option for exercising
            strikeToTransfer // Amount of Strike Asset to send back to the Sushi Pair
        );

        // Perform slippage check
        require(flashBorrow >= _min, "PFE/slippage-too-high");
        require(flashBorrow >= _amount, "PFE/borrow-too-low");

        // Call Flash Swap
        sushiswapV2Pool.swap(
            sushiswapV2Pool.token0() == _option.strikeAsset() ? 0 : flashBorrow,
            sushiswapV2Pool.token0() == _option.strikeAsset() ? flashBorrow : 0,
            address(this),
            forwardedData
        );

        // Reset guard
        flashSwapCaller = address(0);
    }

    /// @notice Uses Sushiswap to exercise an option by leveraging Flash Swap and exercise without providing the required settlement asset
    /// @param _option Address of the Option
    /// @param _amount Amount of Option to exercise
    /// @param _min Slippage parameter. Ensures that the call won't retrieve less than this amount.
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
            _exercisePut(IPodOption(_option), _amount, _min);
        } else {
            _exerciseCall(IPodOption(_option), _amount, _min);
        }
    }

    /// @notice Estimates profits of a put option by taking into account Pool reserves
    /// @param _option Address of the Option
    /// @param _amount Amount of Option to exercise
    function _getEstimatedPutProfits(IPodOption _option, uint256 _amount)
        internal
        view
        returns (uint256)
    {
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

        // Compute amount to borrow
        uint256 flashBorrow = UniswapV2Library.getAmountOut(
            strikeToTransfer,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve0
                : _reserve1,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve1
                : _reserve0
        );

        // There are no profits if we can't borrow more than what is required to settle the option
        if (flashBorrow > _amount) {
            return flashBorrow - _amount;
        }
        return 0;
    }

    /// @notice Estimates profits of a call option by taking into account Pool reserves
    /// @param _option Address of the Option
    /// @param _amount Amount of Option to exercise
    function _getEstimatedCallProfits(IPodOption _option, uint256 _amount)
        internal
        view
        returns (uint256)
    {
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

        // Compute amount to borrow
        uint256 flashBorrow = UniswapV2Library.getAmountOut(
            _amount,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve1
                : _reserve0,
            sushiswapV2Pool.token0() == _option.strikeAsset()
                ? _reserve0
                : _reserve1
        );

        // There are no profits if we can't borrow more than what is required to settle the option
        if (flashBorrow > strikeToTransfer) {
            return flashBorrow - strikeToTransfer;
        }
        return 0;
    }

    /// @notice Estimates profits of an option by taking into account Pool reserves
    /// @param _option Address of the Option
    /// @param _amount Amount of Option to exercise
    function getEstimatedProfits(address _option, uint256 _amount)
        external
        view
        returns (uint256)
    {
        IPodOption option = IPodOption(_option);
        uint256 optionType = option.optionType();
        if (optionType == 0) {
            return _getEstimatedPutProfits(option, _amount);
        }
        return _getEstimatedCallProfits(option, _amount);
    }

    /// @notice Get asset used to pay profits for provided option
    /// @param _option Address of the Option
    function getProfitsAsset(address _option) external view returns (address) {
        IPodOption option = IPodOption(_option);
        uint256 optionType = option.optionType();
        if (optionType == 0) {
            return option.underlyingAsset();
        }
        return option.strikeAsset();
    }
}
