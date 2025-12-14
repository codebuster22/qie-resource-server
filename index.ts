import { Hono } from "hono";
import { paymentMiddleware, type Network, x402ResourceServer } from "@x402/hono";
import type { PaymentRequired, PaymentRequirements, PaywallConfig, PaywallNetworkHandler } from "@x402/paywall";
import { HTTPFacilitatorClient} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from '@x402/paywall';
import { evmPaywall } from '@x402/paywall/evm';
import { getEvmPaywallHtml } from "./src/paywall";

// Environment configuration (Bun auto-loads .env)
const FACILITATOR_URL = process.env.FACILITATOR_URL;
const MERCHANT_WALLET = process.env.MERCHANT_WALLET;
const GIF_URL = process.env.GIF_URL;
const PORT = Number(process.env.PORT) || 3000;

// qUSD Token configuration on QIE
const QUSD_ADDRESS = process.env.QUSD_ADDRESS;
const QUSD_DECIMALS = Number(process.env.QUSD_DECIMALS) || 6;
const QUSD_NAME = process.env.QUSD_NAME || "qUSD";
const QUSD_VERSION = process.env.QUSD_VERSION || "1";

// Validate required environment variables
if (!FACILITATOR_URL) {
  console.error("Error: FACILITATOR_URL environment variable is required");
  process.exit(1);
}

if (!MERCHANT_WALLET) {
  console.error("Error: MERCHANT_WALLET environment variable is required");
  process.exit(1);
}

if (!GIF_URL) {
  console.error("Error: GIF_URL environment variable is required");
  process.exit(1);
}

if (!QUSD_ADDRESS) {
  console.error("Error: QUSD_ADDRESS environment variable is required");
  process.exit(1);
}

// QIE Network configuration
// Note: QIE is not in the default x402 Network type, but the custom Facilitator supports it
const QIE_NETWORK = "eip155:1990" as Network;

// Create Hono app
const app = new Hono();

// Calculate price in atomic units (0.01 USD with QUSD_DECIMALS)
// For 6 decimals: 0.01 * 10^6 = 10000
const PRICE_ATOMIC = "0.01";

const  paywallConfig = {
    appName: 'x402 on QIE',
}

const qiePaywall: PaywallNetworkHandler = {
  supports: (req) => req.network.startsWith('eip155:1990'),
  generateHtml: (
    requirement: PaymentRequirements,
    paymentRequired: PaymentRequired,
    config: PaywallConfig,
  ): string => {
    const amount = requirement.amount
      ? parseFloat(requirement.amount) / 1000000
      : requirement.maxAmountRequired
        ? parseFloat(requirement.maxAmountRequired) / 1000000
        : 0;

    return getEvmPaywallHtml({
      amount,
      paymentRequired,
      currentUrl: paymentRequired.resource?.url || config.currentUrl || "",
      testnet: config.testnet ?? true,
      appName: config.appName,
      appLogo: config.appLogo,
    });
  },
};

const paywall = createPaywall()
  .withNetwork(qiePaywall)
  .withConfig({
    appName: 'x402 on QIE',
    testnet: false
  })
  .build();

const customFacilitator = new HTTPFacilitatorClient({
  url: FACILITATOR_URL as `${string}://${string}`,
});

const resourceServer = new x402ResourceServer(customFacilitator)
  .register(QIE_NETWORK, new ExactEvmScheme().registerMoneyParser(async (amount, network) => {
    if (network == QIE_NETWORK) {
          return {
            amount: BigInt(Math.round(amount * 1e6)).toString(),
            asset: QUSD_ADDRESS,
            extra: { token: QUSD_NAME, name: QUSD_NAME, decimals: QUSD_DECIMALS, version: QUSD_VERSION },
          };
        }
        return null;
  }));

// Configure x402 payment middleware for protected routes
app.use(
  paymentMiddleware(
    {
      "GET /gif": {
        accepts: {
          scheme: "exact",
          price: PRICE_ATOMIC,
          network: QIE_NETWORK,
          payTo: MERCHANT_WALLET,
        },
        description: "Access to premium GIF content",
      },
    },
    resourceServer,
    paywallConfig,
    paywall
  )
);

// Public route - Welcome message
app.get("/", (c) => {
  return c.json({
    message: "Welcome to the x402 Resource Server",
    endpoints: {
      "/": "This welcome message (free)",
      "/health": "Health check endpoint (free)",
      "/gif": "Premium GIF content ($0.01 in qUSD)",
    },
    network: QIE_NETWORK,
  });
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Protected route - GIF content (requires payment)
app.get("/gif", (c) => {
  // This handler only runs after successful payment verification
  return c.json({
    success: true,
    message: "Payment verified! Here is your premium content.",
    gifUrl: GIF_URL,
  });
});

// Start the server
console.log(`Starting x402 Resource Server on port ${PORT}...`);
console.log(`Facilitator URL: ${FACILITATOR_URL}`);
console.log(`Merchant Wallet: ${MERCHANT_WALLET}`);
console.log(`Network: ${QIE_NETWORK}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
