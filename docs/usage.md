# Integrating the x402 Facilitator with Your Resource Server

This guide explains how to connect your Hono-based resource server to the x402 Facilitator for accepting qUSD payments on the QIE blockchain. The goal is to help you understand the concepts and flow rather than provide copy-paste code.

## Table of Contents

1. [Understanding the Payment Flow](#understanding-the-payment-flow)
2. [The Role of Each Participant](#the-role-of-each-participant)
3. [Setting Up Your Resource Server](#setting-up-your-resource-server)
4. [Configuring the Facilitator Connection](#configuring-the-facilitator-connection)
5. [Protecting Your Routes](#protecting-your-routes)
6. [What Happens Behind the Scenes](#what-happens-behind-the-scenes)
7. [Client Integration](#client-integration)
8. [Testing Your Integration](#testing-your-integration)
9. [Going to Production](#going-to-production)

---

## Understanding the Payment Flow

The x402 protocol enables internet-native payments through a simple HTTP-based flow. When a user tries to access a paid resource, instead of redirecting them to a payment page, the protocol handles everything through HTTP headers.

Here's what happens in a typical payment:

1. **User requests a resource** — They make a normal HTTP request to your server
2. **Server responds with payment requirements** — Your server returns a `402 Payment Required` status with details about what payment is needed
3. **User's wallet signs a payment authorization** — The client SDK creates a signed message authorizing the transfer (without actually moving funds yet)
4. **User retries with payment proof** — The request is sent again with the signed authorization in the headers
5. **Server verifies the payment** — Your server asks the Facilitator to validate the signature and check the user's balance
6. **Server delivers the resource** — Once verified, your server provides the content
7. **Facilitator settles the payment** — The Facilitator submits the transaction to the blockchain, and funds move from user to merchant

The beauty of this flow is that users don't need to pre-approve transactions or wait for blockchain confirmations before accessing content.

---

## The Role of Each Participant

### The Client (User)

The client is anyone accessing your paid resources. They need:
- A wallet with qUSD tokens on QIE
- A client SDK that understands the x402 protocol (like `x402-fetch` or `x402-axios`)

The client never interacts with your Facilitator directly — they only communicate with your resource server.

### The Resource Server (You)

Your server is the "merchant" that provides valuable resources in exchange for payment. Your responsibilities are:
- Defining which routes require payment and how much
- Forwarding payment proofs to the Facilitator for verification
- Delivering resources after successful verification
- Optionally triggering settlement (can be immediate or batched)

You don't need to understand blockchain mechanics, manage wallets, or handle gas fees.

### The Facilitator (This Service)

The Facilitator is the bridge between the traditional web and the blockchain. It:
- Verifies that payment signatures are valid and funds are available
- Submits transactions to the QIE blockchain when you request settlement
- Pays gas fees on behalf of users (gasless experience)
- Returns transaction receipts so you have proof of payment

The Facilitator never holds user funds — it only processes pre-signed authorizations.

---

## Setting Up Your Resource Server

### Installing Dependencies

Your Hono server needs the x402 middleware package. The x402-hono package provides everything you need to accept payments with minimal code.

You'll need:
- **hono** — The web framework
- **x402-hono** — The payment middleware
- Optionally, **@x402/evm** for QIE/EVM-specific functionality

### The Middleware Approach

The x402-hono package uses middleware to intercept requests to protected routes. When a request comes in without valid payment, the middleware automatically returns the `402 Payment Required` response with your configured pricing. When a request includes payment headers, the middleware handles verification before your route handler runs.

This means your actual route handlers stay clean and focused on business logic — they only run after payment is confirmed.

---

## Configuring the Facilitator Connection

The most important configuration is telling your middleware where to find the Facilitator. This is your deployed Facilitator service URL.

### Facilitator Configuration

When setting up the payment middleware, you provide a facilitator configuration object that includes:

- **url** — The base URL of your Facilitator service (e.g., `https://your-facilitator.example.com`)
- **createAuthHeaders** (optional) — A function to add authentication headers if your Facilitator requires them

For the QIE Facilitator, your configuration would point to wherever you've deployed this service.

### Network Configuration

You'll also specify:
- **network** — The network identifier in the format `eip155:chainId`. For QIE mainnet, this is `eip155:1990`
- **asset** — The token contract address (your qUSD contract on QIE)

These must match what your Facilitator is configured to support.

---

## Protecting Your Routes

### Defining Paid Routes

The middleware accepts a route configuration object where keys are URL paths and values describe the payment requirements.

For each protected route, you specify:

- **price** — How much to charge (can be in USD like `"$0.10"` or in token amounts)
- **network** — Which blockchain network (`eip155:1990` for QIE)
- **config** (optional) — Additional metadata like description, timeout, and content type

### Route Matching

The middleware supports:
- Exact paths (`/api/premium`)
- Wildcard patterns (`/api/premium/*`)
- Parameter patterns (`/api/users/:id/data`)

Requests to non-protected routes pass through normally without payment checks.

### Dynamic Pricing

For routes where the price depends on the request (like paying per word or per compute unit), you can provide a function instead of a static configuration. This function receives the request and returns the appropriate pricing.

---

## What Happens Behind the Scenes

### When a User First Requests a Paid Resource

1. Request arrives at your server
2. Middleware checks if the route requires payment
3. No payment headers found → middleware returns `402 Payment Required`
4. Response includes:
   - Required payment amount
   - Acceptable payment networks and tokens
   - Your receiving wallet address
   - Facilitator URL for the client to reference
   - Timeout window

### When a User Retries with Payment

1. Request arrives with `PAYMENT-SIGNATURE` header
2. Middleware extracts the payment payload (base64-encoded)
3. Middleware sends the payload to your Facilitator's `/verify` endpoint
4. Facilitator checks:
   - Signature is valid and matches the claimed sender
   - Current time is within the authorization's validity window
   - Nonce hasn't been used (prevents replay attacks)
   - User has sufficient qUSD balance
   - Amount and recipient match requirements
5. If valid → your route handler runs
6. If invalid → middleware returns appropriate error

### Settlement

After verification succeeds, the middleware (or your application) calls the Facilitator's `/settle` endpoint. The Facilitator:

1. Re-verifies the payment (in case state changed)
2. Constructs the blockchain transaction
3. Signs it with the Facilitator's wallet
4. Submits it to QIE mainnet
5. Returns the transaction hash

The user's qUSD moves to your receiving wallet, and the Facilitator's wallet pays the gas fee.

---

## Client Integration

### Using x402-fetch

Users integrating with your API can use the `x402-fetch` package, which wraps the standard `fetch` API and automatically handles the x402 protocol.

When their code makes a request and receives a `402` response, the library:
1. Parses the payment requirements
2. Prompts their wallet to sign an EIP-3009 authorization
3. Retries the request with the payment header

From the developer's perspective, it feels like a normal fetch call that might take a moment longer.

### Using x402-axios

Similar to x402-fetch but for axios users. The library wraps axios and handles the payment flow automatically.

### Direct Integration

For custom clients or other languages, the flow is:
1. Make initial request
2. If 402 received, parse the `PAYMENT-REQUIRED` header (base64 JSON)
3. Create an EIP-3009 `TransferWithAuthorization` signature
4. Encode the payload as base64
5. Retry with `PAYMENT-SIGNATURE` header

---

## Testing Your Integration

### Local Testing Setup

1. **Start your Facilitator** — Run this service locally (needs environment variables configured)
2. **Start your Resource Server** — Configure it to point to your local Facilitator
3. **Get test qUSD** — Deploy qUSD on a testnet or use a mock for development
4. **Use a test wallet** — Configure a wallet with test tokens

### Verifying the Flow

Test each step independently:

1. **Test 402 Response** — Request a protected route without payment headers. You should receive a 402 with proper payment requirements.

2. **Test Verification** — Manually call your Facilitator's `/verify` endpoint with a valid signed payload. Confirm it returns `isValid: true`.

3. **Test Settlement** — Call `/settle` with the same payload. Confirm you get a transaction hash and can find the transaction on the block explorer.

4. **Test Full Flow** — Use an x402 client library to make an end-to-end request.

### Common Issues

- **Signature verification fails** — Check that your EIP-712 domain (name, version, chainId, contract address) matches exactly between client and Facilitator
- **Nonce already used** — Each authorization can only be used once; generate fresh nonces for each payment
- **Insufficient balance** — The user needs qUSD tokens before they can pay
- **Time bounds** — Ensure `validAfter` is in the past and `validBefore` is in the future

---

## Going to Production

### Deploying the Facilitator

Your Facilitator needs:
- A server with reliable uptime (it processes payments!)
- HTTPS enabled (payment data should be encrypted in transit)
- Environment variables properly secured (especially the private key)
- Sufficient QIEV3 in the Facilitator wallet for gas fees

### Deploying Your Resource Server

- Point the facilitator URL to your production Facilitator
- Use your production qUSD contract address
- Set `network` to `eip155:1990` for QIE mainnet
- Configure your production receiving wallet address

### Monitoring

Keep an eye on:
- **Facilitator wallet balance** — Needs QIEV3 for gas; set up alerts if it gets low
- **Failed settlements** — Log and investigate any settlement failures
- **Verification failures** — High failure rates might indicate client integration issues or attacks

### Security Considerations

- **Never expose your Facilitator's private key** — It can spend QIEV3 (and potentially be used maliciously)
- **Use HTTPS everywhere** — Payment headers contain sensitive authorization data
- **Consider rate limiting** — Prevent abuse of your verification endpoint
- **Log everything** — Payment disputes are rare but having logs helps resolve them

---

## Quick Reference

### Facilitator Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/supported` | GET | Returns supported schemes, networks, and assets |
| `/verify` | POST | Validates a payment authorization |
| `/settle` | POST | Executes the payment on-chain |
| `/health` | GET | Health check |

### Key Configuration Values for QIE

| Setting | Value |
|---------|-------|
| Network ID | `eip155:1990` |
| Chain ID | `1990` |
| Native Currency | QIEV3 |
| RPC URL | `https://rpc1mainnet.qie.digital/` |
| Block Explorer | `https://mainnet.qie.digital/` |

### Payment Header Format

- `PAYMENT-SIGNATURE` — Base64-encoded payment payload from client
- `PAYMENT-REQUIRED` — Base64-encoded requirements (in 402 response)
- `PAYMENT-RESPONSE` — Base64-encoded settlement confirmation

---

## Resources

- [x402 Protocol Specification](https://www.x402.org/)
- [x402-hono on npm](https://www.npmjs.com/package/x402-hono)
- [Coinbase x402 Documentation](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers)
- [EIP-3009 Specification](https://eips.ethereum.org/EIPS/eip-3009)
- [QIE Block Explorer](https://mainnet.qie.digital/)
