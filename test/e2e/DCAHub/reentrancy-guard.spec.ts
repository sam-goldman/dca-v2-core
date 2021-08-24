import moment from 'moment';
import { expect } from 'chai';
import { BigNumber, Contract, ContractFactory, utils } from 'ethers';
import { ethers } from 'hardhat';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import {
  DCAGlobalParameters,
  DCAGlobalParameters__factory,
  DCAHub,
  DCAHub__factory,
  TimeWeightedOracleMock,
  TimeWeightedOracleMock__factory,
  ReentrantDCAHubSwapCalleeMock,
  ReentrantDCAHubSwapCalleeMock__factory,
  ReentrantDCAHubLoanCalleeMock,
  ReentrantDCAHubLoanCalleeMock__factory,
} from '@typechained';
import { constants, erc20, evm } from '@test-utils';
import { given, then, when, contract } from '@test-utils/bdd';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { TokenContract } from '@test-utils/erc20';
import { readArgFromEventOrFail } from '@test-utils/event-utils';

contract('DCAHub', () => {
  describe('Reentrancy Guard', () => {
    let governor: SignerWithAddress;
    let dude: SignerWithAddress;
    let feeRecipient: SignerWithAddress;
    let tokenA: TokenContract, tokenB: TokenContract;
    let DCAHubFactory: DCAHub__factory;
    let DCAHub: DCAHub;
    let DCAGlobalParametersFactory: DCAGlobalParameters__factory;
    let DCAGlobalParameters: DCAGlobalParameters;
    let reentrantDCAHubSwapCalleeFactory: ReentrantDCAHubSwapCalleeMock__factory;
    let reentrantDCAHubLoanCalleeFactory: ReentrantDCAHubLoanCalleeMock__factory;
    let TimeWeightedOracleFactory: TimeWeightedOracleMock__factory;
    let TimeWeightedOracle: TimeWeightedOracleMock;
    const swapInterval = moment.duration(10, 'minutes').as('seconds');

    before('Setup accounts and contracts', async () => {
      [governor, dude, feeRecipient] = await ethers.getSigners();
      DCAGlobalParametersFactory = await ethers.getContractFactory(
        'contracts/mocks/DCAGlobalParameters/DCAGlobalParameters.sol:DCAGlobalParametersMock'
      );
      DCAHubFactory = await ethers.getContractFactory('contracts/DCAHub/DCAHub.sol:DCAHub');
      reentrantDCAHubLoanCalleeFactory = await ethers.getContractFactory('contracts/mocks/DCAHubLoanCallee.sol:ReentrantDCAHubLoanCalleeMock');
      reentrantDCAHubSwapCalleeFactory = await ethers.getContractFactory('contracts/mocks/DCAHubSwapCallee.sol:ReentrantDCAHubSwapCalleeMock');
      TimeWeightedOracleFactory = await ethers.getContractFactory('contracts/mocks/DCAHub/TimeWeightedOracleMock.sol:TimeWeightedOracleMock');
    });

    beforeEach('Deploy and configure', async () => {
      await evm.reset();
      tokenA = await erc20.deploy({
        name: 'tokenA',
        symbol: 'TKNA',
      });
      tokenB = await erc20.deploy({
        name: 'tokenB',
        symbol: 'TKNB',
      });
      TimeWeightedOracle = await TimeWeightedOracleFactory.deploy(0, 0);
      DCAGlobalParameters = await DCAGlobalParametersFactory.deploy(
        governor.address,
        constants.NOT_ZERO_ADDRESS,
        feeRecipient.address,
        constants.NOT_ZERO_ADDRESS,
        TimeWeightedOracle.address
      );
      DCAHub = await DCAHubFactory.deploy(DCAGlobalParameters.address, tokenA.address, tokenB.address);
      await DCAGlobalParameters.addSwapIntervalsToAllowedList([swapInterval], ['NULL']);
    });

    describe('loan', () => {
      const rateTokenA = 50;
      const swapsTokenA = 13;
      let totalTokenA: BigNumber;
      let reentrantDCAHubLoanCallee: ReentrantDCAHubLoanCalleeMock;
      given(async () => {
        totalTokenA = tokenA.asUnits(rateTokenA).mul(swapsTokenA);
        await deposit({
          token: () => tokenA,
          depositor: dude,
          rate: rateTokenA,
          swaps: swapsTokenA,
        });
        reentrantDCAHubLoanCallee = await reentrantDCAHubLoanCalleeFactory.deploy();
      });

      testReentrantForFunction({
        funcAndSignature: 'loan(uint256,uint256,address,bytes)',
        args: () => [totalTokenA.sub(1), 0, reentrantDCAHubLoanCallee.address, '0x'],
        attackerContract: () => reentrantDCAHubLoanCallee,
      });
    });

    describe('flash swap', () => {
      const rateTokenA = 50;
      const swapsTokenA = 13;
      let totalTokenA: BigNumber;
      let reentrantDCAHubSwapCallee: ReentrantDCAHubSwapCalleeMock;
      given(async () => {
        await TimeWeightedOracle.setRate(tokenA.asUnits('1'), 18);
        totalTokenA = tokenA.asUnits(rateTokenA).mul(swapsTokenA);
        await deposit({
          token: () => tokenA,
          depositor: dude,
          rate: rateTokenA,
          swaps: swapsTokenA,
        });
        reentrantDCAHubSwapCallee = await reentrantDCAHubSwapCalleeFactory.deploy();
      });

      testReentrantForFunction({
        funcAndSignature: 'swap(uint256,uint256,address,bytes)',
        args: () => [0, 0, reentrantDCAHubSwapCallee.address, utils.formatBytes32String('')],
        attackerContract: () => reentrantDCAHubSwapCallee,
      });
    });

    async function testReentrantAttack({
      title,
      funcAndSignature,
      args,
      attackerContract,
      attack,
    }: {
      title: string;
      funcAndSignature: string;
      args: () => any[];
      attackerContract: () => Contract;
      attack: () => Promise<string>;
    }) {
      when(title, () => {
        let reentrantTx: Promise<TransactionResponse>;
        given(async () => {
          await attackerContract().setAttack(await attack());
          reentrantTx = (DCAHub as any)[funcAndSignature](...args());
        });
        then('tx is reverted', async () => {
          await expect(reentrantTx).to.be.revertedWith('ReentrancyGuard: reentrant call');
        });
      });
    }

    async function testReentrantForFunction({
      funcAndSignature,
      args,
      attackerContract,
    }: {
      funcAndSignature: string;
      args: () => any[];
      attackerContract: () => Contract;
    }) {
      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a deposit',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.deposit(constants.ZERO_ADDRESS, 0, 0, 0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through withdrawing swapped',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.withdrawSwapped(0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through withdrawing swapped many',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.withdrawSwappedMany([])).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through terminate',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.terminate(0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through modifying rate',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.modifyRate(0, 0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through modifying swaps',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.modifySwaps(0, 0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through modifying rate and swaps',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.modifyRateAndSwaps(0, 0, 0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through addFundsToPosition',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.addFundsToPosition(0, 0, 0)).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a swap',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction['swap()']()).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a flash swap',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () =>
          (await DCAHub.populateTransaction['swap(uint256,uint256,address,bytes)'](0, 0, constants.NOT_ZERO_ADDRESS, '0x')).data!,
      });

      testReentrantAttack({
        title: 'trying to do a reentrancy attack through a flash loan',
        funcAndSignature,
        args,
        attackerContract,
        attack: async () => (await DCAHub.populateTransaction.loan(0, 0, constants.NOT_ZERO_ADDRESS, '0x')).data!,
      });
    }

    async function deposit({
      token,
      depositor,
      rate,
      swaps,
    }: {
      token: () => TokenContract;
      depositor: SignerWithAddress;
      rate: number;
      swaps: number;
    }) {
      await token().mint(depositor.address, token().asUnits(rate).mul(swaps));
      await token().connect(depositor).approve(DCAHub.address, token().asUnits(rate).mul(swaps));
      const response: TransactionResponse = await DCAHub.connect(depositor).deposit(token().address, token().asUnits(rate), swaps, swapInterval);
      const dcaId = await readArgFromEventOrFail<BigNumber>(response, 'Deposited', '_dcaId');
      return { response, dcaId };
    }
  });
});