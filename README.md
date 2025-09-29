# Product Reservation Shopify App

An extension-only Shopify app that implements a product reservation system with a serverless backend. The app allows customers to reserve products through a modal form and creates draft orders for merchants to process.

## Architecture

This app consists of:

1. **Theme Extension** (`extensions/reserve-product/`): Frontend UI that merchants install on their storefront

   - Modal-based reservation form with practice info, contact details, and role selection
   - Form validation and reCAPTCHA v3 integration
   - Internationalization support (English/French)

2. **Serverless Backend** (`netlify/functions/`): API endpoints via Netlify Functions
   - `create-draft-order.js`: Main business logic for creating draft orders with reserved products
   - OAuth flow handlers for Shopify API authentication
   - App proxy integration at `/apps/reserve-product/*`

## Getting started

### Requirements

1. [Node.js](https://nodejs.org/en/download/) installed
1. [Shopify Partner account](https://partners.shopify.com/signup)
1. [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) installed
1. [Netlify CLI](https://docs.netlify.com/cli/get-started/) installed
1. A [development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) for testing
1. [reCAPTCHA v3](https://developers.google.com/recaptcha/docs/v3) keys

### Installation

1. Clone this repository and install dependencies:

```bash
npm install
```

2. Ensure you have the `.env` file with required environment variables (should be provided during handoff)

### Local Development

Start the combined development server (Shopify + Netlify):

```bash
npm run dev
```

This runs both the Shopify CLI dev server and Netlify functions locally.

For independent development:

- Shopify extensions only: `npm run shopify -- app dev`
- Netlify functions only: `npm run netlify-dev`

### Deployment

Deploy to production using CLI commands:

1. **Deploy Netlify Functions:**

```bash
netlify deploy --prod
# or use npm script:
npm run deploy-functions
```

2. **Deploy Shopify App Extensions:**

```bash
shopify app deploy
# or use npm script:
npm run deploy
```

### Additional Commands

```bash
# View app configuration
shopify app info
# or: npm run shopify -- app info

# Build the app
npm run build
```

## How It Works

### Form Submission Flow

1. Customer fills reservation form in modal on product page
2. Frontend validates input and captures reCAPTCHA token
3. POST request sent to `/apps/reserve-product/create-draft-order`
4. Backend validates shop domain, creates draft order, updates product metafields
5. Returns draft order ID and invoice URL to frontend

### Product Metafields

The app manages these product metafields:

- `custom.availability_status`: Tracks reservation state
- `custom.reservation_id`: Links product to draft order
- Various practice and contact info fields

## Testing

Development store app testing workflow:

1. Install app on development store ✅
2. Ensure reserve form block is added product page in theme admin
3. Test reservation flow end-to-end
4. Verify draft order creation in Shopify admin
5. Check product metafields are updated correctly
6. Mirror changes to production app code and re-deploy (to the appropriate Netlify account).

Prod store app testing will be performed by A-dec team.

## Developer Resources

- [Shopify App Extensions](https://shopify.dev/docs/apps/build/app-extensions)
- [Extension Only Apps](https://shopify.dev/docs/apps/build/app-extensions/build-extension-only-app)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Netlify Functions](https://docs.netlify.com/functions/overview/)
- [App Proxy](https://shopify.dev/docs/apps/build/online-store/app-proxies)
