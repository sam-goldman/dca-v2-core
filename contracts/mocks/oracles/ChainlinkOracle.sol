// SPDX-License-Identifier: UNLICENSED

pragma solidity >=0.5.0 <0.8.0;

import '../../oracles/ChainlinkOracle.sol';

contract ChainlinkOracleMock is ChainlinkOracle {
  struct MockedPricingPlan {
    PricingPlan plan;
    bool isSet;
  }

  mapping(address => mapping(address => bool)) public addSupportForPairCalled;
  mapping(address => mapping(address => MockedPricingPlan)) private _pricingPlan;

  // solhint-disable-next-line var-name-mixedcase
  constructor(address _WETH, FeedRegistryInterface _registry) ChainlinkOracle(_WETH, _registry) {}

  function internalAddSupportForPair(address _tokenA, address _tokenB) external {
    _addSupportForPair(_tokenA, _tokenB);
  }

  function _addSupportForPair(address _tokenA, address _tokenB) internal override {
    addSupportForPairCalled[_tokenA][_tokenB] = true;
    super._addSupportForPair(_tokenA, _tokenB);
  }

  function reset(address _tokenA, address _tokenB) external {
    delete addSupportForPairCalled[_tokenA][_tokenB];
  }

  function setPricingPlan(
    address _tokenA,
    address _tokenB,
    PricingPlan _plan
  ) external {
    (address __tokenA, address __tokenB) = _sortTokens(_tokenA, _tokenB);
    _pricingPlan[__tokenA][__tokenB] = MockedPricingPlan({plan: _plan, isSet: true});
  }

  function _determinePricingPlan(address _tokenA, address _tokenB) internal view override returns (PricingPlan) {
    (address __tokenA, address __tokenB) = _sortTokens(_tokenA, _tokenB);
    MockedPricingPlan memory _plan = _pricingPlan[__tokenA][__tokenB];
    if (_plan.isSet) {
      return _plan.plan;
    } else {
      return super._determinePricingPlan(__tokenA, __tokenB);
    }
  }
}