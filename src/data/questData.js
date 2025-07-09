// 메모리에 저장된 Quest 데이터 (실제 프로덕션에서는 DB 사용을 권장)
const questData = {
  'hackathon-temp': [
    {
      id: '1',
      projectName: 'KK',
      questName: 'Hold KK Token on BaseSepolia Network',
      description: 'Hold minimum 5 KK tokens in your wallet on Base Sepolia network',
      reward: { amount: 5, token: 'KK' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: process.env.BASESEPOLIA_KKCOIN_ADDRESS || '0x0000000000000000000000000000000000000000',
      network: 'basesepolia',
      minAmount: '5'
    },
    {
      id: '7',
      projectName: 'KK',
      questName: 'Hold KK Token on BaseSepolia Network #2',
      description: 'Hold minimum 30 KK tokens in your wallet on Base Sepolia network',
      reward: { amount: 30, token: 'KK' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: process.env.BASESEPOLIA_KKCOIN_ADDRESS || '0x0000000000000000000000000000000000000000',
      network: 'basesepolia',
      minAmount: '30'
    }
  ],
  'lootpang-curation': [
    {
      id: '2',
      projectName: 'Base Protocol',
      questName: 'Bridge ETH to Base Network',
      description: 'Bridge ETH from Ethereum mainnet to Base network',
      reward: { amount: 10, token: 'BASE' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'base',
      minAmount: '0.01'
    },
    {
      id: '3',
      projectName: 'Uniswap',
      questName: 'Provide Liquidity on Uniswap V3',
      description: 'Add liquidity to any pool on Uniswap V3',
      reward: { amount: 50, token: 'UNI' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '100'
    },
    {
      id: '4',
      projectName: 'Aave',
      questName: 'Supply Assets to Aave',
      description: 'Supply any asset to Aave lending protocol',
      reward: { amount: 25, token: 'AAVE' },
      isCompleted: true,
      canWithdraw: true,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '50'
    },
    {
      id: '5',
      projectName: 'Compound',
      questName: 'Borrow from Compound',
      description: 'Borrow any asset from Compound protocol',
      reward: { amount: 15, token: 'COMP' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '10'
    },
    {
      id: '6',
      projectName: 'Chainlink',
      questName: 'Use Chainlink Price Feeds',
      description: 'Interact with Chainlink price feed oracles',
      reward: { amount: 20, token: 'LINK' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '25'
    }
  ]
};

module.exports = questData;
