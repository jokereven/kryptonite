import { Wait } from "../../utils/wait";
import { Web3Client, GetWeb3ContractClient } from "../web3";

const ERC20Abi: any = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
];

export class Wallet {
  Address: string;
  MaskedAddress: string;
  Key: string;
  ChainID: number;

  constructor(address: string, key: string, chainId: number) {
    this.Address = address;
    this.MaskedAddress = address
      .split("")
      .map((c, idx) => {
        if (idx < 5 || idx > address.length - 6) {
          return c;
        } else {
          return "*";
        }
      })
      .join("");
    this.Key = key;
    this.ChainID = chainId;
  }

  async GetBalance(): Promise<bigint> {
    const balance = await Web3Client.eth.getBalance(this.Address);
    return BigInt(balance);
  }

  async GetTokenBalance(tokenContractAddress: string): Promise<bigint> {
    const contract = GetWeb3ContractClient(ERC20Abi, tokenContractAddress);
    const balance = await contract.methods.balanceOf(this.Address).call();
    return BigInt(balance);
  }

  async SignTransaction(transaction: any): Promise<any> {
    const tx: any = await Web3Client.eth.accounts.signTransaction(
      transaction,
      this.Key
    );
    const { rawTransaction, transactionHash } = tx;
    return { rawTransaction, transactionHash };
  }

  async EstimateGas(transaction: any): Promise<number> {
    const gas: number = await Web3Client.eth.estimateGas({
      ...transaction,
      from: this.Address,
    });
    return gas;
  }

  async GetTransactionReceipt(txHash: string): Promise<boolean> {
    while (true) {
      const receipt = await Web3Client.eth.getTransactionReceipt(txHash);
      if (receipt != null) {
        console.log(`Fetched transaction receipt for ${txHash}`);
        return receipt.status;
      } else {
        await Wait(5);
      }
    }
  }

  async GetNonce() {
    const nonce = await Web3Client.eth.getTransactionCount(
      this.Address,
      "pending"
    );
    return nonce;
  }

  async SuggestGasPrice() {
    const gasPrice = await Web3Client.eth.getGasPrice();
    return gasPrice;
  }

  async BroadcastRawTransaction(transaction: any) {
    const { transactionHash } = await Web3Client.eth.sendSignedTransaction(
      transaction
    );
    return transactionHash;
  }
}
