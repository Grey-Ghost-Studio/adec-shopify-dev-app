// netlify/functions/create-draft-order.js

const crypto = require('crypto');
const axios = require('axios');

// In production, use a database to store tokens
// This is a simplified example
const tokens = {};

exports.handler = async function(event, context) {
  // Set CORS headers for preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

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
    const isValid = verifyShopifyProxy(queryParams);
    if (!isValid) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
    
    // Get the access token for this shop
    // In production, retrieve from a database
    let accessToken = tokens[shop];
    
    // If no token available, check our token endpoint
    if (!accessToken) {
      try {
        // In production, this would be a database lookup
        const tokenResponse = await axios.get(
          `https://adec-shopify-dev-app.netlify.app/.netlify/functions/oauth/token?shop=${shop}`
        );
        
        if (tokenResponse.data && tokenResponse.data.access_token) {
          accessToken = tokenResponse.data.access_token;
          tokens[shop] = accessToken; // Cache it
        }
      } catch (error) {
        console.error('Error retrieving token:', error);
      }
    }
    
    // If still no token, return error
    if (!accessToken) {
      return {
        statusCode: 401,
        body: JSON.stringify({ 
          error: 'Unauthorized', 
          token_required: true 
        })
      };
    }
    
    // Make API call to create draft order
    const response = await axios.post(
      `https://${shop}/admin/api/2023-04/draft_orders.json`,
      { draft_order },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Return successful response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        draft_order: response.data.draft_order
      })
    };
  } catch (error) {
    console.error("Error creating draft order:", error);
    
    // Handle expired tokens
    if (error.response && error.response.status === 401) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: "Access token expired",
          token_required: true
        })
      };
    }
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message || "Server error"
      })
    };
  }
};

/**
 * Verifies the request signature from Shopify App Proxy
 */
function verifyShopifyProxy(query) {
  const { signature, shop, timestamp, ...otherParams } = query;
  
  // Proxy secret from environment variables
  const appProxySecret = process.env.SHOPIFY_APP_PROXY_SECRET;
  
  if (!appProxySecret) {
    console.error('Missing SHOPIFY_APP_PROXY_SECRET environment variable');
    return false;
  }
  
  try {
    // Create the message from the shop and timestamp
    const message = `shop=${shop}&timestamp=${timestamp}`;
    
    // Calculate the hash using the proxy secret
    const calculatedSignature = crypto
      .createHmac('sha256', appProxySecret)
      .update(message)
      .digest('hex');
    
    // Compare calculated signature with provided signature
    return signature === calculatedSignature;
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}s