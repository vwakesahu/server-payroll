const express = require("express");
const { ethers, Wallet, hexlify } = require("ethers");
require("dotenv").config();
const cors = require("cors");
const { encrypted300Value } = require("./encrypted300value");
const app = express();
const PORT = process.env.PORT || 8080;
const { createInstance } = require("fhevmjs");

let fhevmInstance = null;

const createFhevmInstance = async () => {
  if (!fhevmInstance) {
    fhevmInstance = await createInstance({
      chainId: 21097,
      networkUrl: "https://validator.rivest.inco.org/",
      gatewayUrl: "https://gateway.rivest.inco.org/",
      aclAddress: "0x2Fb4341027eb1d2aD8B5D9708187df8633cAFA92",
    });
  }
  return fhevmInstance;
};

const getFhevmInstance = async () => {
  if (!fhevmInstance) {
    fhevmInstance = await createFhevmInstance();
  }
  return fhevmInstance;
};

const toHexString = (bytes) => {
  return bytes.reduce(
    (str, byte) => str + byte.toString(16).padStart(2, "0"),
    ""
  );
};

// Load environment variables
const BASE_SEPOLIA_PROVIDER_URL = process.env.BASE_SEPOLIA_PROVIDER_URL;
const BASE_SEPOLIA_PRIVATE_KEY = process.env.BASE_SEPOLIA_PRIVATE_KEY;
const BASE_SEPOLIA_CONTRACT_ADDRESS =
  "0xe05996cDC331c3b69667D64812B79C3cC873Ecfe";

const INCO_PROVIDER_URL = process.env.INCO_PROVIDER_URL;
const INCO_PRIVATE_KEY = process.env.INCO_PRIVATE_KEY;
const INCO_CONTRACT_ADDRESS = "0x397c2554eABC3dCc705eC2abD874753d090e6D52";

const incoDomainId = 21097;
const baseSepoliaDomainId = 1320;

const INCO_ABI = require("./incoContractABI.json"); // Load the contract ABI
const BASE_SEPOLIA_ABI = require("./baseSepoliaContractABI.json"); // Load the contract ABI

app.use(cors());
app.use(express.json({ limit: "2mb" })); // Set limit to handle large payloads

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Setup provider and wallet for Sepolia
const baseSepoliaProvider = new ethers.JsonRpcProvider(
  BASE_SEPOLIA_PROVIDER_URL
);
const baseSepoliaWallet = new ethers.Wallet(
  BASE_SEPOLIA_PRIVATE_KEY,
  baseSepoliaProvider
);
const baseSepoliaContract = new ethers.Contract(
  BASE_SEPOLIA_CONTRACT_ADDRESS,
  BASE_SEPOLIA_ABI,
  baseSepoliaWallet
);

// Setup provider and wallet for Inco
const incoProvider = new ethers.JsonRpcProvider(INCO_PROVIDER_URL);

const incoWallet = new ethers.Wallet(INCO_PRIVATE_KEY, incoProvider);
const incoContract = new ethers.Contract(
  INCO_CONTRACT_ADDRESS,
  INCO_ABI,
  incoWallet
);

const getEncryptedInput = async (input) => {
  const signer = await provider.getSigner();
  const instance = await getFhevmInstance();
  const einput = await instance.createEncryptedInput(
    contractAddress, // swayam has it
    await signer.getAddress()
  );

  const encryptedInput = await einput.add64(Number(input));
  console.log(encryptedInput);
  return {
    proof: "0x" + toHexString(encryptedInput.inputProof),
    handle: "0x" + toHexString(encryptedInput.handles[0]),
  };
};

const fetchBalance = async (ownerAddress, safeAddress) => {
  const signer = await provider.getSigner();
  const instance = await getFhevmInstance();
  try {
    const { publicKey, privateKey } = instance.generateKeypair();
    const eip712 = instance.createEIP712(
      publicKey,
      ENCRYPTEDERC20CONTRACTADDRESS // swayam has it
    );

    const signature = await signer._signTypedData(
      eip712.domain,
      { Reencrypt: eip712.types.Reencrypt },
      eip712.message
    );

    const encryptedErc20Contract = new Contract(
      ENCRYPTEDERC20CONTRACTADDRESS, // swayam has
      ENCRYPTEDERC20CONTRACTABI, // swayam has
      signer
    );

    const balanceHandle = await encryptedErc20Contract.balanceOf(
      await signer.getAddress() // ownerAddress
    );

    if (balanceHandle.toString() === "0") {
      return 0;
    } else {
      const balanceResult = await fhevmInstance.reencrypt(
        balanceHandle,
        privateKey,
        publicKey,
        signature.replace("0x", ""),
        ENCRYPTEDERC20CONTRACTADDRESS, // swayam has it
        await signer.getAddress()
      );

      return balanceResult;
    }
  } catch (err) {
    console.error("cUSDC Balance Error:", err);
    setBalances((prev) => ({
      ...prev,
      [safeAddress]: { ...prev[safeAddress], cusdc: null },
    }));
  } finally {
    setLoadingStates((prev) => ({
      ...prev,
      [safeAddress]: { ...prev[safeAddress], cusdcLoading: false },
    }));
  }
};

// Event listener function for Sepolia
async function listenToEventsBaseSepoliaForDispatchProxy() {
  console.log("Listening for Dispatch events on Base Sepolia...");
  baseSepoliaContract.on(
    "DispatchProxy",
    async (destination, recipient, actualMessage, event) => {
      console.log(`Dispatch event detected on Sepolia:
            Destination: ${destination}
            Recipient: ${recipient}
            Message: ${actualMessage}`);
      // Convert recipient bytes32 to address
      actualRecipient = "0x" + recipient.substring(26, 66);
      try {
        // Call handle function on Inco
        const senderBytes = await ethers.zeroPadValue(
          hexlify(BASE_SEPOLIA_CONTRACT_ADDRESS),
          32
        );
        await callHandleOnInco(
          baseSepoliaDomainId,
          senderBytes,
          actualRecipient,
          actualMessage
        );
      } catch (error) {
        console.error("Error processing Dispatch event on Sepolia:", error);
      }
    }
  );
}

// Event listener function for Inco
async function listenToEventsInco() {
  console.log("Listening for Dispatch events on Inco...");

  incoContract.on(
    "DispatchProxy",
    async (destination, recipient, actualMessage, event) => {
      console.log(`Dispatch event detected on Inco:
            Destination: ${destination}
            Recipient: ${recipient}
            Message: ${actualMessage}`);
      // Convert recipient bytes32 to address
      actualRecipient = "0x" + recipient.substring(26, 66);
      try {
        // Call handle function on Inco
        const senderBytes = await ethers.zeroPadValue(
          hexlify(INCO_CONTRACT_ADDRESS),
          32
        );
        await callHandleOnBaseSepolia(
          incoDomainId,
          senderBytes,
          actualRecipient,
          actualMessage
        );
      } catch (error) {
        console.error("Error processing Dispatch event on Sepolia:", error);
      }
    }
  );
}

// Function to call handle on Sepolia
async function callHandleOnBaseSepolia(
  origin,
  sender,
  recipientAddress,
  message
) {
  try {
    const contractToCall = new ethers.Contract(
      BASE_SEPOLIA_CONTRACT_ADDRESS,
      BASE_SEPOLIA_ABI,
      baseSepoliaWallet
    );
    const tx = await contractToCall.handle(21097, sender, message, {
      gasLimit: 7000000, // Adjust gas limit as needed
    });
    await tx.wait();
  } catch (error) {
    console.error("Error calling handle function on Base Sepolia:", error);
  }
}

// Function to call handle on Inco
async function callHandleOnInco(origin, sender, recipientAddress, message) {
  try {
    const contractToCall = new ethers.Contract(
      INCO_CONTRACT_ADDRESS,
      INCO_ABI,
      incoWallet
    );
    const tx = await contractToCall.handle(origin, sender, message, {
      gasLimit: 7000000, // Adjust gas limit as needed
    });
    await tx.wait();

    console.log(`handle function called on Inco with tx: ${tx.hash}`);
  } catch (error) {
    console.error("Error calling handle function on Inco:", error);
  }
}

// Route to handle post request from frontend
app.post("/distribute-funds", async (req, res) => {
  console.log("hit");
  const {
    user,
    userAddress1,
    userAddresses2,
    userAddresses3,
    amount1,
    amount2,
    amount3,
  } = req.body;

  console.log(
    user,
    userAddress1,
    userAddresses2,
    userAddresses3,
    amount1,
    amount2,
    amount3
  );

  const instance = await getFhevmInstance();
  const einput1 = await instance.createEncryptedInput(
    INCO_CONTRACT_ADDRESS,
    await incoWallet.getAddress()
  );

  const encryptedInput = await einput1
    .add32(Number(amount1))
    .add32(Number(amount2))
    .add32(Number(amount3));

  const encryptedValue = await encryptedInput.encrypt();

  if (!user || !userAddress1 || !userAddresses2 || !userAddresses3) {
    return res.status(400).send("Invalid input");
  }

  console.log(encryptedValue);

  try {
    await settleDispatchDistributionOfFunds(
      user,
      [userAddress1, userAddresses2, userAddresses3],
      [
        encryptedValue.handles[0],
        encryptedValue.handles[1],
        encryptedValue.handles[2],
      ],
      encryptedValue.inputProof
    );
    res.status(200).send("Funds distributed successfully");
  } catch (error) {
    console.error("Error in /distribute-funds route:", error);
    res.status(500).send("Error distributing funds");
  }
});

// Function to call distributeFunds on Inco
async function settleDispatchDistributionOfFunds(
  user,
  userAddresses,
  encryptedData,
  inputProof
) {
  try {
    const contractToCall = new ethers.Contract(
      INCO_CONTRACT_ADDRESS,
      INCO_ABI,
      incoWallet
    );
    // // Convert the values to BigNumber to ensure correct handling
    // const maxBaseFee = ethers.BigNumber.from("3000000000");
    // const maxPriorityFee = ethers.BigNumber.from("3000000000");
    // const gasLimit = ethers.BigNumber.from("30000000"); // 30 million gas

    // // Construct overrides with gasLimit, maxFeePerGas (optional if using EIP-1559)
    // const overrides = {
    //   gasLimit: gasLimit, // 30 million gas
    //   maxFeePerGas: maxBaseFee.add(maxPriorityFee), // maxFeePerGas should be maxBaseFee + maxPriorityFee
    // };
    const tx = await contractToCall.distributeFunds(
      user,
      userAddresses,
      encryptedData,
      inputProof,
      { gasLimit: 10000000 }
    );

    await tx.wait();

    console.log(`distributeFunds function called on Inco with tx: ${tx.hash}`);
  } catch (error) {
    console.error("Error calling distributeFunds function on Inco:", error);
  }
}

// Event listener function for Inco
async function listenToDispatchWithdrawFunds() {
  console.log("Listening for WithdrawFunds events on Base Sepolia...");

  baseSepoliaContract.on("DispatchWithdrawFunds", async (user) => {
    console.log(`Dispatch event detected on Base Sepolia:
            user: ${user}`);
    try {
      await settleDispatchWithdrawOfFunds(user);
    } catch (error) {
      console.error("Error processing Dispatch event on Sepolia:", error);
    }
  });
}

// Function to call handle on Inco
async function settleDispatchWithdrawOfFunds(user) {
  try {
    console.log(user, "user");
    const contractToCall = new ethers.Contract(
      INCO_CONTRACT_ADDRESS,
      INCO_ABI,
      incoWallet
    );

    const instance = await getFhevmInstance();
    const balanceHandle = await contractToCall.balanceOfUser(user);
    console.log(balanceHandle, "balanceHandle");

    const { publicKey, privateKey } = instance.generateKeypair();

    const eip712 = instance.createEIP712(publicKey, INCO_CONTRACT_ADDRESS);
    console.log("called eip712");
    const signature = await incoWallet.signTypedData(
      eip712.domain,
      { Reencrypt: eip712.types.Reencrypt },
      eip712.message
    );
    console.log("called signature");
    console.log(await incoWallet.getAddress(), "address");

    let balance;

    if (balanceHandle.toString() === "0") {
      balance = 0;
    } else {
      const balanceResult = await instance.reencrypt(
        balanceHandle,
        privateKey,
        publicKey,
        signature.replace("0x", ""),
        INCO_CONTRACT_ADDRESS,
        await incoWallet.getAddress()
      );

      balance = balanceResult;
    }
    const message = await contractToCall.returnMessage(
      BASE_SEPOLIA_CONTRACT_ADDRESS,
      ethers.parseEther(balance.toString())
    );
    console.log(balance);
    const tx = await contractToCall.withdrawFunds(user, balance, {
      gasLimit: 7000000,
    });
    await tx.wait();

    const addressToBytes32 = await contractToCall.addressToBytes32(
      INCO_CONTRACT_ADDRESS
    );

    await callHandleOnBaseSepolia(
      21097,
      addressToBytes32,
      BASE_SEPOLIA_CONTRACT_ADDRESS,
      message
    );

    console.log(`handle function called on Inco with tx: ${tx.hash}`);
  } catch (error) {
    console.error("Error calling handle function on Inco:", error);
  }
}

app.get("/balance/:address", async (req, res) => {
  try {
    const userAddress = req.params.address;

    const contractToCall = new ethers.Contract(
      INCO_CONTRACT_ADDRESS,
      INCO_ABI,
      incoWallet
    );

    const instance = await getFhevmInstance();

    const balanceHandle = await contractToCall.balanceOfUser(userAddress);

    // Generate keypair
    const { publicKey, privateKey } = instance.generateKeypair();

    // Create EIP712 data
    const eip712 = instance.createEIP712(publicKey, INCO_CONTRACT_ADDRESS);

    // Get signature
    const signature = await incoWallet.signTypedData(
      eip712.domain,
      { Reencrypt: eip712.types.Reencrypt },
      eip712.message
    );

    let balance;

    // Check if balance handle is zero
    if (balanceHandle.toString() === "0") {
      balance = "0";
    } else {
      // Reencrypt balance
      const balanceResult = await instance.reencrypt(
        balanceHandle,
        privateKey,
        publicKey,
        signature.replace("0x", ""),
        INCO_CONTRACT_ADDRESS,
        await incoWallet.getAddress()
      );

      console.log("balanceResult:", balanceResult);
      balance = balanceResult.toString();
    }

    // Return success response
    return res.status(200).json({
      success: true,
      data: {
        address: userAddress,
        balance: balance,
        walletAddress: await incoWallet.getAddress(),
      },
    });
  } catch (error) {
    console.error("Error fetching balance:", error);

    // Return error response
    return res.status(500).json({
      success: false,
      error: "Error fetching balance",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Start the Express server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Start listening to events on both chains
  listenToEventsBaseSepoliaForDispatchProxy().catch(console.error);
  listenToEventsInco().catch(console.error);
  listenToDispatchWithdrawFunds().catch(console.error);
});

server.on("error", (error) => {
  console.error("Server error:", error);
});
