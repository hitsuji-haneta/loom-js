import test from 'tape'
import Web3 from 'web3'
import BN from 'bn.js'

import { increaseTime, getEthBalanceAtAddress } from './ganache-helpers'
import {
  sleep,
  ADDRESSES,
  setupContracts,
  web3Endpoint,
  setupAccounts,
  disconnectAccounts
} from './config'

export async function runChallengeBetweenDemo(t: test.Test) {
  const web3 = new Web3(new Web3.providers.HttpProvider(web3Endpoint))
  const { cards } = setupContracts(web3)
  const cardsAddress = ADDRESSES.token_contract

  const accounts = await setupAccounts()
  const alice = accounts.alice
  const bob = accounts.bob
  const eve = accounts.eve

  const bobTokensStart = await cards.balanceOfAsync(bob.ethAddress)

  // Give Eve 5 tokens
  await cards.registerAsync(eve.ethAddress)

  // Eve deposits a coin
  await eve.depositERC721Async(new BN(11), cardsAddress)
  const deposits = await eve.deposits()
  t.equal(deposits.length, 1, 'Eve has correct number of deposits')

  const deposit1Slot = deposits[0].slot

  // Eve sends her plasma coin to Bob
  const coin = await eve.getPlasmaCoinAsync(deposit1Slot)
  let currentBlock = await eve.getCurrentBlockAsync()
  await eve.transferAndVerifyAsync(deposit1Slot, bob.ethAddress, 6)
  currentBlock = await eve.pollForBlockChange(currentBlock, 20, 2000)

  t.equal(await bob.receiveAndWatchCoinAsync(deposit1Slot), true, 'Coin history verified')

  // Eve sends this same plasma coin to Alice
  await eve.transferAndVerifyAsync(deposit1Slot, alice.ethAddress, 6)
  currentBlock = await eve.pollForBlockChange(currentBlock, 20, 2000)

  // Alice attempts to exit her double-spent coin
  // Low level call to exit the double spend
  t.equal(await alice.receiveAndWatchCoinAsync(deposit1Slot), false, 'Alice accepted faux coin')
  await alice.startExitAsync({
    slot: deposit1Slot,
    prevBlockNum: coin.depositBlockNum,
    exitBlockNum: currentBlock
  })
  // Bob challenges here

  await sleep(2000)

  await bob.exitAsync(deposit1Slot)

  // Jump forward in time by 8 days
  await increaseTime(web3, 8 * 24 * 3600)

  await bob.finalizeExitAsync(deposit1Slot)

  await bob.withdrawAsync(deposit1Slot)

  const bobBalanceBefore = await getEthBalanceAtAddress(web3, bob.ethAddress)

  await bob.withdrawBondsAsync()

  const bobBalanceAfter = await getEthBalanceAtAddress(web3, bob.ethAddress)

  t.ok(bobBalanceBefore.cmp(bobBalanceAfter) < 0, 'END: Bob withdrew his bonds')

  const bobTokensEnd = await cards.balanceOfAsync(bob.ethAddress)

  t.equal(
    bobTokensEnd.toNumber(),
    bobTokensStart.toNumber() + 1,
    'END: Bob has correct number of tokens'
  )

  disconnectAccounts(accounts)

  t.end()
}
