require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

/**
 * Hardhat config for deploying RevenueSplit to Arc testnet.
 * Run `npm i` inside contracts/ to install the toolbox, then:
 *   npm run contracts:compile
 *   npm run contracts:deploy
 */
module.exports = {
  solidity: "0.8.24",
  networks: {
    arcTestnet: {
      url: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
      chainId: Number(process.env.ARC_CHAIN_ID || "13371"),
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
