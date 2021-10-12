import { expect } from 'chai';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { ethers } from 'hardhat';
import { behaviours, constants } from '@test-utils';
import { given, then, when } from '@test-utils/bdd';
import { ChainlinkOracleMock__factory, ChainlinkOracleMock } from '@typechained';
import { snapshot } from '@test-utils/evm';

describe('ChainlinkOracle', () => {
  const TOKEN_A = '0x0000000000000000000000000000000000000001';
  const TOKEN_B = '0x0000000000000000000000000000000000000002';
  const WETH = '0x0000000000000000000000000000000000000003';
  const FEED_REGISTRY = '0x0000000000000000000000000000000000000004';
  const NO_PLAN = 0;
  const A_PLAN = 1;

  let chainlinkOracleFactory: ChainlinkOracleMock__factory;
  let chainlinkOracle: ChainlinkOracleMock;
  let snapshotId: string;

  before('Setup accounts and contracts', async () => {
    chainlinkOracleFactory = await ethers.getContractFactory('contracts/mocks/oracles/ChainlinkOracle.sol:ChainlinkOracleMock');
    chainlinkOracle = await chainlinkOracleFactory.deploy(WETH, FEED_REGISTRY);
    snapshotId = await snapshot.take();
  });

  beforeEach('Deploy and configure', async () => {
    await snapshot.revert(snapshotId);
  });

  describe('constructor', () => {
    when('weth is zero address', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: chainlinkOracleFactory,
          args: [constants.ZERO_ADDRESS, FEED_REGISTRY],
          message: 'ZeroAddress',
        });
      });
    });
    when('feed registry is zero address', () => {
      then('tx is reverted with reason error', async () => {
        await behaviours.deployShouldRevertWithMessage({
          contract: chainlinkOracleFactory,
          args: [WETH, constants.ZERO_ADDRESS],
          message: 'ZeroAddress',
        });
      });
    });
    when('all arguments are valid', () => {
      then('WETH is set correctly', async () => {
        const weth = await chainlinkOracle.WETH();
        expect(weth).to.equal(WETH);
      });
      then('registry is set correctly', async () => {
        const registry = await chainlinkOracle.registry();
        expect(registry).to.eql(FEED_REGISTRY);
      });
    });
  });

  describe('canSupportPair', () => {
    when('no plan can be found for pair', () => {
      given(async () => {
        await chainlinkOracle.setPricingPlan(TOKEN_A, TOKEN_B, NO_PLAN);
      });
      then('pair is not supported', async () => {
        expect(await chainlinkOracle.canSupportPair(TOKEN_A, TOKEN_B)).to.be.false;
      });
    });
    when('a plan can be found for a pair', () => {
      given(async () => {
        await chainlinkOracle.setPricingPlan(TOKEN_A, TOKEN_B, A_PLAN);
      });
      then('pair is supported', async () => {
        expect(await chainlinkOracle.canSupportPair(TOKEN_A, TOKEN_B)).to.be.true;
      });
      then('pair is supported even when tokens are reversed', async () => {
        expect(await chainlinkOracle.canSupportPair(TOKEN_B, TOKEN_A)).to.be.true;
      });
    });
  });

  describe('reconfigureSupportForPair', () => {
    when(`the function is called`, () => {
      given(async () => {
        await chainlinkOracle.setPricingPlan(TOKEN_A, TOKEN_B, A_PLAN);
        await chainlinkOracle.reconfigureSupportForPair(TOKEN_A, TOKEN_B);
      });
      then(`then the internal add support is called directly`, async () => {
        expect(await chainlinkOracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.true;
      });
    });
  });

  describe('addSupportForPairIfNeeded', () => {
    when('a plan is already defined', () => {
      given(async () => {
        await chainlinkOracle.setPricingPlan(TOKEN_A, TOKEN_B, A_PLAN);
        await chainlinkOracle.internalAddSupportForPair(TOKEN_A, TOKEN_B);
        await chainlinkOracle.reset(TOKEN_A, TOKEN_B);
      });
      then('internal add support is not called', async () => {
        await chainlinkOracle.addSupportForPairIfNeeded(TOKEN_A, TOKEN_B);
        expect(await chainlinkOracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.false;
      });
      then('internal add support is not called even if tokens are inverted', async () => {
        await chainlinkOracle.addSupportForPairIfNeeded(TOKEN_B, TOKEN_A);
        expect(await chainlinkOracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.false;
      });
    });
    when('pair is not defined yet', () => {
      given(async () => {
        await chainlinkOracle.setPricingPlan(TOKEN_A, TOKEN_B, A_PLAN);
        await chainlinkOracle.addSupportForPairIfNeeded(TOKEN_A, TOKEN_B);
      });
      then('internal add support is called', async () => {
        expect(await chainlinkOracle.addSupportForPairCalled(TOKEN_A, TOKEN_B)).to.be.true;
      });
    });
  });

  describe('internalAddSupportForPair', () => {
    when('no plan can be found for pair', () => {
      given(async () => {
        await chainlinkOracle.setPricingPlan(TOKEN_A, TOKEN_B, NO_PLAN);
      });
      then('tx is reverted with reason', async () => {
        await behaviours.txShouldRevertWithMessage({
          contract: chainlinkOracle,
          func: 'internalAddSupportForPair',
          args: [TOKEN_A, TOKEN_B],
          message: 'Pair not supported',
        });
      });
    });
    when('a plan can be calculated for the pair', () => {
      const SOME_OTHER_PLAN = 2;
      let tx: TransactionResponse;
      given(async () => {
        await chainlinkOracle.setPricingPlan(TOKEN_A, TOKEN_B, SOME_OTHER_PLAN);
        tx = await chainlinkOracle.internalAddSupportForPair(TOKEN_A, TOKEN_B);
      });
      then(`it is marked as the new plan`, async () => {
        expect(await chainlinkOracle.planForPair(TOKEN_A, TOKEN_B)).to.eql(SOME_OTHER_PLAN);
      });

      then('event is emmitted', async () => {
        await expect(tx).to.emit(chainlinkOracle, 'AddedChainlinkSupportForPair').withArgs(TOKEN_A, TOKEN_B);
      });
    });
  });
});