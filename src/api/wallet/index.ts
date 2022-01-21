import Web3 from "web3";
import { GetRpcURLByChainID } from "../../networks";

/**
 * ERC20 minimal ABI
 */
const ERC20Abi: any = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
];

/**
 * Wallet API
 */
export class Wallet {
  Address: string;
  Key: string;
  ChainID: number;

  constructor(address: string, key: string, chainId: number) {
    this.Address = address;
    this.Key = key;
    this.ChainID = chainId;
  }

  /**
   * GetBalance returns the wallet balance
   * @returns Promise<number> Wallet balance
   */
  async GetBalance(): Promise<number> {
    const web3 = new Web3(GetRpcURLByChainID(this.ChainID));
    const balance = await web3.eth.getBalance(this.Address);
    return Number(balance);
  }

  /**
   * GetTokenBalance returns the token balance at the given contract address
   * @param tokenContractAddress
   * @returns Promise<number> Token balance
   */
  async GetTokenBalance(tokenContractAddress: string): Promise<number> {
    const web3 = new Web3(GetRpcURLByChainID(this.ChainID));
    const contract = new web3.eth.Contract(ERC20Abi, tokenContractAddress);
    const balance = await contract.methods.balanceOf(this.Address).call();
    return Number(balance);
  }

  /**
   * SignTransaction signs the given transaction
   * @param transaction Transaction to sign
   * @returns Promise<string> Raw transaction
   */
  async SignTransaction(transaction: any): Promise<string> {
    const web3 = new Web3(GetRpcURLByChainID(this.ChainID));
    const tx: any = await web3.eth.accounts.signTransaction(
      transaction,
      this.Key
    );
    return tx.rawTransaction || "";
  }

  /**
   * EstimateGas estimates the gas required for the transaction
   * @param transaction
   * @returns Estimated gas amount
   */
  async EstimateGas(transaction: any): Promise<number> {
    const web3 = new Web3(GetRpcURLByChainID(this.ChainID));
    const gas: number = await web3.eth.estimateGas({
      ...transaction,
      from: this.Address,
    });
    return gas;
  }
}