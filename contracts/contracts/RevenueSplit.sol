// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 surface (USDC on Arc).
interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/**
 * @title RevenueSplit
 * @notice Splits a single USDC payment between a creator, the platform, and a
 *         referrer (default 85% / 10% / 5%). The buyer agent (or any payer)
 *         approves this contract for the line-range price, then calls `pay`.
 *
 *         Pull-based and atomic: either every leg transfers or the whole call
 *         reverts, so a creator is never short-changed. Designed to be the
 *         `payTo` target of an x402 / Circle Gateway settlement on Arc.
 */
contract RevenueSplit {
    IERC20 public immutable usdc;
    address public immutable platform;
    address public immutable referrer;

    uint16 public constant CREATOR_BPS = 8500;
    uint16 public constant PLATFORM_BPS = 1000;
    uint16 public constant REFERRER_BPS = 500;
    uint16 public constant BPS = 10000;

    event Paid(
        address indexed payer,
        address indexed creator,
        uint256 total,
        uint256 creatorAmount,
        uint256 platformAmount,
        uint256 referrerAmount,
        bytes32 indexed ref
    );

    constructor(address _usdc, address _platform, address _referrer) {
        require(_usdc != address(0) && _platform != address(0) && _referrer != address(0), "zero addr");
        usdc = IERC20(_usdc);
        platform = _platform;
        referrer = _referrer;
    }

    /**
     * @param creator destination for the creator share
     * @param amount  total USDC (6 decimals) to split; payer must approve first
     * @param ref     opaque reference (e.g. content id + line range hash)
     */
    function pay(address creator, uint256 amount, bytes32 ref) external {
        require(creator != address(0), "zero creator");
        require(amount > 0, "zero amount");

        uint256 platformAmount = (amount * PLATFORM_BPS) / BPS;
        uint256 referrerAmount = (amount * REFERRER_BPS) / BPS;
        uint256 creatorAmount = amount - platformAmount - referrerAmount; // remainder to creator

        require(usdc.transferFrom(msg.sender, creator, creatorAmount), "creator xfer");
        require(usdc.transferFrom(msg.sender, platform, platformAmount), "platform xfer");
        require(usdc.transferFrom(msg.sender, referrer, referrerAmount), "referrer xfer");

        emit Paid(msg.sender, creator, amount, creatorAmount, platformAmount, referrerAmount, ref);
    }
}
