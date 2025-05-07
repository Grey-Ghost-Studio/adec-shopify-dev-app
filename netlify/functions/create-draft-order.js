// Function file: create-draft-order.js
const crypto = require('crypto');
const { Shopify, ApiVersion } = require('@shopify/shopify-api');

exports.handler = async function(event, context) {
  try {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    // Parse request body
    const requestBody = JSON.parse(event.body);
    const { draft_order } = requestBody;
    
    if (!draft_order) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing draft order data' })
      };
    }
    
    // Extract shop and signature from query parameters
    const queryParams = event.queryStringParameters || {};
    const { shop, signature, timestamp } = queryParams;
    
    if (!shop || !signature || !timestamp) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required query parameters' })
      };
    }
    
    // Verify the request is coming from Shopify
    const isValid = verifyRequest(shop, signature, timestamp);
    if (!isValid) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
    
    // Initialize Shopify API
    const shopify = new Shopify({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      apiVersion: ApiVersion.April24,
      isEmbeddedApp: true,
      hostName: process.env.HOST ? process.env.HOST.replace(/https:\/\//, '') : ''
    });
    
    // Get a session token for API access
    const accessToken = await getStoreAccessToken(shop);
    if (!accessToken) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Could not authenticate with the store' })
      };
    }
    
    // Create client for Shopify Admin API
    const client = new shopify.clients.Rest({
      session: {
        shop,
        accessToken
      }
    });
    
    // Make API call to create draft order
    const response = await client.post({
      path: 'draft_orders',
      data: { draft_order }
    });
    
    // Return successful response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        draft_order: response.body.draft_order
      })
    };
  } catch (error) {
    console.error("Error creating draft order:", error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message || "Server error"
      })
    };
  }
};

/**
 * Verifies the request signature from Shopify
 */
function verifyRequest(shop, signature, timestamp) {
  const appProxySecret = process.env.SHOPIFY_APP_PROXY_SECRET;
  
  if (!appProxySecret) {
    console.error('Missing APP_PROXY_SECRET');
    return false;
  }
  
  // Create the message from the shop and timestamp
  const message = `shop=${shop}&timestamp=${timestamp}`;
  
  // Calculate the hash using the proxy secret
  const calculatedSignature = crypto
    .createHmac('sha256', appProxySecret)
    .update(message)
    .digest('hex');
  
  // Compare calculated signature with provided signature
  return crypto.timingSafeEqual(
    Buffer.from(calculatedSignature, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/**
 * Gets a valid access token for the store
 * This is a simplified example - in production, you would use a database 
 * to store and retrieve tokens for each shop
 */
async function getStoreAccessToken(shop) {
  // In a production app, you would retrieve this from your database
  // where you stored it during the OAuth process
  
  // For demo purposes only - DO NOT USE IN PRODUCTION
  // In a real app, you should look up this token from your database
  // based on the shop domain
  return process.env[`TOKEN_${shop.replace(/\./g, '_')}`] || null;
}