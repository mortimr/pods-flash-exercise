import { FakeUSDC } from "../typechain/FakeUSDC";
import { FakeWETH } from "../typechain/FakeWETH";
import { SushiswapV2FactoryMock } from "../typechain/SushiswapV2FactoryMock";
import { UniswapV2Pair } from "../typechain/UniswapV2Pair";
import { UniswapV2Pair__factory } from "../typechain/factories/UniswapV2Pair__factory";
import { BigNumber } from "@ethersproject/bignumber";
import { getAddress } from "ethers/lib/utils";
import { ConfigurationManager } from "../typechain/ConfigurationManager";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { PodsFlashExercise } from "../typechain/PodsFlashExercise";
import Decimal from "decimal.js";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { FakeAAVE } from "../typechain/FakeAAVE";
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

chai.use(chaiAsPromised);

// Then either:
const expect = chai.expect;

interface TestContext {
  fakeUSDC: FakeUSDC;
  fakeWETH: FakeWETH;
  fakeAAVE: FakeAAVE;
  sushiswapV2Factory: SushiswapV2FactoryMock;
  sushiswapV2Pair: UniswapV2Pair;
  configurationManagerMock: ConfigurationManager;
  pfe: PodsFlashExercise;
  poolSpotPrice: BigNumber;
  signer: SignerWithAddress;
}

describe("PodsFlashExercise", function () {
  const ctx: TestContext = {
    fakeUSDC: null,
    fakeWETH: null,
    fakeAAVE: null,
    sushiswapV2Factory: null,
    sushiswapV2Pair: null,
    configurationManagerMock: null,
    pfe: null,
    poolSpotPrice: null,
    signer: null,
  };
  let snapshotId;

  const snapshot = async function () {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  };

  const restore = async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  };

  before(async function () {
    const [signer] = await ethers.getSigners();
    ctx.signer = signer;
    const FakeUSDCFactory = await ethers.getContractFactory("FakeUSDC");
    ctx.fakeUSDC = await FakeUSDCFactory.deploy();
    const FakeWETHFactory = await ethers.getContractFactory("FakeWETH");
    ctx.fakeWETH = await FakeWETHFactory.deploy();
    const FakeAAVEFactory = await ethers.getContractFactory("FakeAAVE");
    ctx.fakeAAVE = await FakeAAVEFactory.deploy();
    const ConfigurationManagerFactory = await ethers.getContractFactory(
      "ConfigurationManagerMock"
    );
    ctx.configurationManagerMock = await ConfigurationManagerFactory.deploy();
    const SushiswapV2FactoryFactory = await ethers.getContractFactory(
      "SushiswapV2FactoryMock"
    );
    const CapProviderFactory = await ethers.getContractFactory(
      "CapProviderMock"
    );
    const CapProviderInstance = await CapProviderFactory.deploy();
    ctx.configurationManagerMock.setCapProvider(CapProviderInstance.address);
    ctx.sushiswapV2Factory = await SushiswapV2FactoryFactory.deploy();
    await ctx.sushiswapV2Factory.createPair(
      ctx.fakeUSDC.address,
      ctx.fakeWETH.address
    );
    const pairAddress = await ctx.sushiswapV2Factory.getPair(
      ctx.fakeUSDC.address,
      ctx.fakeWETH.address
    );
    ctx.sushiswapV2Pair = new UniswapV2Pair__factory(
      (await ethers.getSigners())[0]
    ).attach(pairAddress);

    const PFEFactory = await ethers.getContractFactory("PodsFlashExercise");
    ctx.pfe = await PFEFactory.deploy(ctx.sushiswapV2Factory.address);

    await ctx.fakeUSDC.mint(
      ctx.sushiswapV2Pair.address,
      BigNumber.from(1000000).mul(
        BigNumber.from(10).pow(await ctx.fakeUSDC.decimals())
      )
    );
    await ctx.fakeWETH.mint(
      ctx.sushiswapV2Pair.address,
      BigNumber.from(1000).mul(
        BigNumber.from(10).pow(await ctx.fakeWETH.decimals())
      )
    );
    await ctx.sushiswapV2Pair.mint(signer.address);
    const reserves = await ctx.sushiswapV2Pair.getReserves();
    if (
      getAddress(await ctx.sushiswapV2Pair.token0()) ===
      getAddress(ctx.fakeUSDC.address)
    ) {
      ctx.poolSpotPrice = BigNumber.from(10)
        .pow(await ctx.fakeUSDC.decimals())
        .mul(reserves._reserve0)
        .div(reserves._reserve1);
    } else {
      ctx.poolSpotPrice = BigNumber.from(10)
        .pow(await ctx.fakeUSDC.decimals())
        .mul(reserves._reserve1)
        .div(reserves._reserve0);
    }
    console.log(
      `1.000 x $${await ctx.fakeWETH.symbol()} = ${new Decimal(
        ctx.poolSpotPrice.toString()
      )
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toFixed(3)} $${await ctx.fakeUSDC.symbol()}`
    );
    console.log();
    await snapshot();
  });

  beforeEach(async function () {
    await restore();
    await snapshot();
  });

  it("Should fail when building with null sushiswap factory address", async function () {
    const pfeFactory = await ethers.getContractFactory("PodsFlashExercise");
    await expect(
      pfeFactory.deploy(`0x${"0".repeat(40)}`)
    ).to.eventually.be.rejectedWith("PFE/null-sushiswap-v2-factory");
  });

  it("Should fail on unexpected callback invocation swap caller", async function () {
    await expect(
      ctx.pfe.uniswapV2Call(`0x${"0".repeat(40)}`, 0, 0, "0x")
    ).to.eventually.be.rejectedWith("PFE/invalid-swap-caller");
  });

  it("Should fail on unexpected callback invocation callback caller", async function () {
    await expect(
      ctx.pfe.uniswapV2Call(ctx.pfe.address, 0, 0, "0x")
    ).to.eventually.be.rejectedWith("PFE/invalid-callback-caller");
  });

  it("Properly exercise WETH/USDC Pods Call", async function () {
    const podCallFactory = await ethers.getContractFactory("PodCallMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podCallFactory.deploy(
      "Fake Pods WETH/USDC Call",
      "FPW/UC",
      0,
      ctx.fakeWETH.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(80).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    await ctx.fakeWETH.approve(podOptionInstance.address, amount);

    await ctx.fakeWETH.mint(ctx.signer.address, amount);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    const displayAmount = new Decimal(amount.toString()).div(
      `1e${await ctx.fakeWETH.decimals()}`
    );

    console.log(
      `For ${displayAmount.toFixed(
        3
      )} x ${await podOptionInstance.name()} @ ${new Decimal(
        (await podOptionInstance.strikePrice()).toString()
      )
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toFixed(3)} $${await ctx.fakeUSDC.symbol()}:`
    );
    console.log(
      " - Underlying asset before flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset before flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
    const profitAsset = await ctx.pfe.getProfitsAsset(
      podOptionInstance.address
    );
    const ProfitAsset = new Contract(
      profitAsset,
      ctx.fakeWETH.interface,
      ctx.signer
    );
    const preBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const estimatedReturns = await ctx.pfe.getEstimatedProfits(
      podOptionInstance.address,
      amount
    );
    await ctx.pfe.flashExercise(podOptionInstance.address, amount, 0);
    const postBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const difference = postBalance.sub(preBalance);
    expect(difference.toString()).to.equal(estimatedReturns.toString());
    console.log(
      " - Underlying asset after flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset after flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
  });

  it("Properly exercise USDC/WETH Pods Call", async function () {
    const podCallFactory = await ethers.getContractFactory("PodCallMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podCallFactory.deploy(
      "Fake Pods USDC/WETH Call",
      "FPU/WC",
      0,
      ctx.fakeUSDC.address,
      ctx.fakeWETH.address,
      BigNumber.from(10)
        .pow(await ctx.fakeWETH.decimals())
        .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
        .div(ctx.poolSpotPrice)
        .mul(80)
        .div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeUSDC.decimals())
      .mul(1000);

    await ctx.fakeUSDC.approve(podOptionInstance.address, amount);

    await ctx.fakeUSDC.mint(ctx.signer.address, amount);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    const displayAmount = new Decimal(amount.toString()).div(
      `1e${await ctx.fakeUSDC.decimals()}`
    );

    console.log(
      `For ${displayAmount.toFixed(
        3
      )} x ${await podOptionInstance.name()} @ ${new Decimal(
        (await podOptionInstance.strikePrice()).toString()
      )
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toFixed(4)} $${await ctx.fakeWETH.symbol()}:`
    );

    console.log(
      " - Underlying asset before flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset before flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
    const profitAsset = await ctx.pfe.getProfitsAsset(
      podOptionInstance.address
    );
    const ProfitAsset = new Contract(
      profitAsset,
      ctx.fakeWETH.interface,
      ctx.signer
    );
    const preBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const estimatedReturns = await ctx.pfe.getEstimatedProfits(
      podOptionInstance.address,
      amount
    );
    await ctx.pfe.flashExercise(podOptionInstance.address, amount, 0);
    const postBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const difference = postBalance.sub(preBalance);
    expect(difference.toString()).to.equal(estimatedReturns.toString());
    console.log(
      " - Underlying asset after flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset after flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
  });

  it("Properly exercise WETH/USDC Pods Put", async function () {
    const podPutFactory = await ethers.getContractFactory("PodPutMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podPutFactory.deploy(
      "Fake Pods WETH/USDC Put",
      "FPW/UP",
      0,
      ctx.fakeWETH.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(120).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    const amountToTransfer = await podOptionInstance.strikeToTransfer(amount);

    await ctx.fakeUSDC.mint(ctx.signer.address, amountToTransfer);

    await ctx.fakeUSDC.approve(podOptionInstance.address, amountToTransfer);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    const displayAmount = new Decimal(amount.toString()).div(
      `1e${await ctx.fakeWETH.decimals()}`
    );

    console.log(
      `For ${displayAmount.toFixed(
        3
      )} x ${await podOptionInstance.name()} @ ${new Decimal(
        (await podOptionInstance.strikePrice()).toString()
      )
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toFixed(3)} $${await ctx.fakeUSDC.symbol()}:`
    );

    console.log(
      " - Underlying asset before flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset before flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
    const profitAsset = await ctx.pfe.getProfitsAsset(
      podOptionInstance.address
    );
    const ProfitAsset = new Contract(
      profitAsset,
      ctx.fakeWETH.interface,
      ctx.signer
    );
    const preBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const estimatedReturns = await ctx.pfe.getEstimatedProfits(
      podOptionInstance.address,
      amount
    );
    await ctx.pfe.flashExercise(podOptionInstance.address, amount, 0);
    const postBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const difference = postBalance.sub(preBalance);
    expect(difference.toString()).to.equal(estimatedReturns.toString());
    console.log(
      " - Underlying asset after flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset after flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
  });

  it("Properly exercise USDC/WETH Pods Put", async function () {
    const podPutFactory = await ethers.getContractFactory("PodPutMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podPutFactory.deploy(
      "Fake Pods USDC/WETH Put",
      "FPU/WP",
      0,
      ctx.fakeUSDC.address,
      ctx.fakeWETH.address,
      BigNumber.from(10)
        .pow(await ctx.fakeWETH.decimals())
        .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
        .div(ctx.poolSpotPrice)
        .mul(120)
        .div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeUSDC.decimals())
      .mul(1000);

    const amountToTransfer = await podOptionInstance.strikeToTransfer(amount);

    await ctx.fakeWETH.mint(ctx.signer.address, amountToTransfer);

    await ctx.fakeWETH.approve(podOptionInstance.address, amountToTransfer);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    const displayAmount = new Decimal(amount.toString()).div(
      `1e${await ctx.fakeUSDC.decimals()}`
    );

    console.log(
      `For ${displayAmount.toFixed(
        3
      )} x ${await podOptionInstance.name()} @ ${new Decimal(
        (await podOptionInstance.strikePrice()).toString()
      )
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toFixed(4)} $${await ctx.fakeWETH.symbol()}:`
    );

    console.log(
      " - Underlying asset before flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset before flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
    const profitAsset = await ctx.pfe.getProfitsAsset(
      podOptionInstance.address
    );
    const ProfitAsset = new Contract(
      profitAsset,
      ctx.fakeWETH.interface,
      ctx.signer
    );
    const preBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const estimatedReturns = await ctx.pfe.getEstimatedProfits(
      podOptionInstance.address,
      amount
    );
    await ctx.pfe.flashExercise(podOptionInstance.address, amount, 0);
    const postBalance = await ProfitAsset.balanceOf(ctx.signer.address);
    const difference = postBalance.sub(preBalance);
    expect(difference.toString()).to.equal(estimatedReturns.toString());
    console.log(
      " - Underlying asset after flash exercise",
      new Decimal((await ctx.fakeUSDC.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeUSDC.decimals()}`)
        .toNumber()
    );
    console.log(
      " - Strike asset after flash exercise",
      new Decimal((await ctx.fakeWETH.balanceOf(ctx.signer.address)).toString())
        .div(`1e${await ctx.fakeWETH.decimals()}`)
        .toNumber()
    );
  });

  it("Should fail on PUT as strike is not reached", async function () {
    const podPutFactory = await ethers.getContractFactory("PodPutMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podPutFactory.deploy(
      "Fake Pods WETH/USDC Put",
      "FPW/UP",
      0,
      ctx.fakeWETH.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(80).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    const amountToTransfer = await podOptionInstance.strikeToTransfer(amount);

    await ctx.fakeUSDC.mint(ctx.signer.address, amountToTransfer);

    await ctx.fakeUSDC.approve(podOptionInstance.address, amountToTransfer);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    const estimatedReturns = await ctx.pfe.getEstimatedProfits(
      podOptionInstance.address,
      amount
    );
    expect(estimatedReturns.toString()).to.equal("0");
    await expect(
      ctx.pfe.flashExercise(podOptionInstance.address, amount, 0)
    ).to.eventually.be.rejectedWith("PFE/borrow-too-low");
  });

  it("Should fail on CALL as strike is not reacher", async function () {
    const podCallFactory = await ethers.getContractFactory("PodCallMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podCallFactory.deploy(
      "Fake Pods WETH/USDC Call",
      "FPW/UC",
      0,
      ctx.fakeWETH.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(120).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    await ctx.fakeWETH.approve(podOptionInstance.address, amount);

    await ctx.fakeWETH.mint(ctx.signer.address, amount);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    const estimatedReturns = await ctx.pfe.getEstimatedProfits(
      podOptionInstance.address,
      amount
    );
    expect(estimatedReturns.toString()).to.equal("0");
    await expect(
      ctx.pfe.flashExercise(podOptionInstance.address, amount, 0)
    ).to.eventually.be.rejectedWith("PFE/borrow-too-low");
  });

  it("Should fail if not in exercise window", async function () {
    const podPutFactory = await ethers.getContractFactory("PodPutMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podPutFactory.deploy(
      "Fake Pods WETH/USDC Put",
      "FPW/UP",
      0,
      ctx.fakeWETH.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(120).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    const amountToTransfer = await podOptionInstance.strikeToTransfer(amount);

    await ctx.fakeUSDC.mint(ctx.signer.address, amountToTransfer);

    await ctx.fakeUSDC.approve(podOptionInstance.address, amountToTransfer);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    await expect(
      ctx.pfe.flashExercise(podOptionInstance.address, amount, 0)
    ).to.eventually.be.rejectedWith("PFE/not-exercise-window");
  });

  it("Fails on slippage too high (CALL case 1)", async function () {
    const podCallFactory = await ethers.getContractFactory("PodCallMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podCallFactory.deploy(
      "Fake Pods WETH/USDC Call",
      "FPW/UC",
      0,
      ctx.fakeWETH.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(80).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    await ctx.fakeWETH.approve(podOptionInstance.address, amount);

    await ctx.fakeWETH.mint(ctx.signer.address, amount);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    await expect(
      ctx.pfe.flashExercise(
        podOptionInstance.address,
        amount,
        amount
          .mul(ctx.poolSpotPrice)
          .div(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
      )
    ).to.eventually.be.rejectedWith("PFE/slippage-too-high");
  });

  it("Fails on slippage too high (CALL case 2)", async function () {
    const podCallFactory = await ethers.getContractFactory("PodCallMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podCallFactory.deploy(
      "Fake Pods USDC/WETH Call",
      "FPU/WC",
      0,
      ctx.fakeUSDC.address,
      ctx.fakeWETH.address,
      BigNumber.from(10)
        .pow(await ctx.fakeWETH.decimals())
        .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
        .div(ctx.poolSpotPrice)
        .mul(80)
        .div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeUSDC.decimals())
      .mul(1000);

    await ctx.fakeUSDC.approve(podOptionInstance.address, amount);

    await ctx.fakeUSDC.mint(ctx.signer.address, amount);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    await expect(
      ctx.pfe.flashExercise(
        podOptionInstance.address,
        amount,
        amount
          .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
          .div(ctx.poolSpotPrice)
      )
    ).to.eventually.be.rejectedWith("PFE/slippage-too-high");
  });

  it("Fails on slippage too high (PUT case 1)", async function () {
    const podPutFactory = await ethers.getContractFactory("PodPutMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podPutFactory.deploy(
      "Fake Pods WETH/USDC Put",
      "FPW/UP",
      0,
      ctx.fakeWETH.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(120).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    const amountToTransfer = await podOptionInstance.strikeToTransfer(amount);

    await ctx.fakeUSDC.mint(ctx.signer.address, amountToTransfer);

    await ctx.fakeUSDC.approve(podOptionInstance.address, amountToTransfer);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    await expect(
      ctx.pfe.flashExercise(
        podOptionInstance.address,
        amount,
        amountToTransfer
          .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
          .div(ctx.poolSpotPrice)
      )
    ).to.eventually.be.rejectedWith("PFE/slippage-too-high");
  });

  it("Fails on slippage too high (PUT case 2)", async function () {
    const podPutFactory = await ethers.getContractFactory("PodPutMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podPutFactory.deploy(
      "Fake Pods USDC/WETH Put",
      "FPU/WP",
      0,
      ctx.fakeUSDC.address,
      ctx.fakeWETH.address,
      BigNumber.from(10)
        .pow(await ctx.fakeWETH.decimals())
        .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
        .div(ctx.poolSpotPrice)
        .mul(120)
        .div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeUSDC.decimals())
      .mul(1000);

    const amountToTransfer = await podOptionInstance.strikeToTransfer(amount);

    await ctx.fakeWETH.mint(ctx.signer.address, amountToTransfer);

    await ctx.fakeWETH.approve(podOptionInstance.address, amountToTransfer);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    await expect(
      ctx.pfe.flashExercise(
        podOptionInstance.address,
        amount,
        amountToTransfer
          .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
          .div(
            BigNumber.from(10)
              .pow(await ctx.fakeWETH.decimals())
              .mul(BigNumber.from(10).pow(await ctx.fakeUSDC.decimals()))
              .div(ctx.poolSpotPrice)
          )
      )
    ).to.eventually.be.rejectedWith("PFE/slippage-too-high");
  });

  it("Should fail exercising due to inexistant Sushiswap market (CALL case)", async function () {
    const podCallFactory = await ethers.getContractFactory("PodCallMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podCallFactory.deploy(
      "Fake Pods AAVE/USDC Call",
      "FPW/UC",
      0,
      ctx.fakeAAVE.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(80).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeAAVE.decimals())
      .mul(1);

    await ctx.fakeAAVE.approve(podOptionInstance.address, amount);

    await ctx.fakeAAVE.mint(ctx.signer.address, amount);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    await expect(
      ctx.pfe.flashExercise(podOptionInstance.address, amount, 0)
    ).to.eventually.be.rejectedWith("PFE/no-sushi-pool-available");
  });

  it("Should fail exercising due to inexistant Sushiswap market (PUT case)", async function () {
    const podPutFactory = await ethers.getContractFactory("PodPutMock");
    const oneDay = 24 * 60 * 60;
    const expiration = Math.floor(Date.now() / 1000) + oneDay * 2;
    const podOptionInstance = await podPutFactory.deploy(
      "Fake Pods AAVE/USDC Put",
      "FPW/UP",
      0,
      ctx.fakeAAVE.address,
      ctx.fakeUSDC.address,
      ctx.poolSpotPrice.mul(120).div(100),
      expiration,
      oneDay,
      ctx.configurationManagerMock.address
    );

    const amount = BigNumber.from(10)
      .pow(await ctx.fakeWETH.decimals())
      .mul(1);

    const amountToTransfer = await podOptionInstance.strikeToTransfer(amount);

    await ctx.fakeUSDC.mint(ctx.signer.address, amountToTransfer);

    await ctx.fakeUSDC.approve(podOptionInstance.address, amountToTransfer);

    await podOptionInstance.mint(amount, ctx.signer.address);

    await ethers.provider.send("evm_increaseTime", [oneDay]);

    await podOptionInstance.approve(ctx.pfe.address, amount);

    await expect(
      ctx.pfe.flashExercise(podOptionInstance.address, amount, 0)
    ).to.eventually.be.rejectedWith("PFE/no-sushi-pool-available");
  });
});
