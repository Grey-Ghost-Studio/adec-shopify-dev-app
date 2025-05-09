import crypto from 'crypto';
import axios from 'axios';

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export const handler = async function(event, context) {
  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  try {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    // Parse request body
    const { draft_order } = JSON.parse(event.body || '{}');
    if (!draft_order) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing draft order data' })
      };
    }
    
    // Extract and validate query parameters
    const queryParams = event.queryStringParameters || {};
    const { signature, timestamp } = queryParams;
    if (!signature || !timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required query parameters' })
      };
    }
    
    // Verify the request is coming from Shopify
    const verificationResult = verifyShopifySignature(queryParams);
    if (!verificationResult.valid) {
      console.log("Verification failed:", verificationResult.method);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
    
    // Check for access token
    if (!ACCESS_TOKEN) {
      console.error("Missing SHOPIFY_ACCESS_TOKEN environment variable");
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Server configuration error - missing access token' })
      };
    }
    
    // Make API call to create draft order
    const response = await axios.post(
      `https://${SHOP_DOMAIN}/admin/api/2023-04/draft_orders.json`,
      { draft_order },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Return successful response
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        draft_order: response.data.draft_order
      })
    };
  } catch (error) {
    console.error("Error creating draft order:", error);
    
    // Handle specific 401 errors
    if (error.response && error.response.status === 401) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Access token expired or invalid"
        })
      };
    }
    
    // Generic error response
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message || "Server error"
      })
    };
  }
};

/**
 * Verifies if a request is coming from Shopify based on the signature
 */
function verifyShopifySignature(query) {
  const { signature, ...params } = query;
  
  if (!signature || !SHOPIFY_API_SECRET) {
    return { valid: false, method: 'Missing signature or API secret' };
  }
  
  // Try different signature methods - we know Method 4 works from previous logs
  try {
    // Method 4: All params sorted, no separator (the one that worked previously)
    const signatureString = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('');
    
    const calculatedSignature = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(signatureString)
      .digest('hex');
    
    if (signature === calculatedSignature) {
      return { valid: true, method: 'Method 4: All params sorted, no separator' };
    }
    
    // Fallback to other methods if the primary one doesn't work
    const methods = [
      // Method 1: shop & timestamp with & separator
      { 
        string: `shop=${params.shop || SHOP_DOMAIN}&timestamp=${params.timestamp}`,
        label: 'Method 1: shop & timestamp with & separator'
      },
      // Method 2: shop & timestamp with no separator
      {
        string: `shop=${params.shop || SHOP_DOMAIN}timestamp=${params.timestamp}`,
        label: 'Method 2: shop & timestamp with no separator'
      },
      // Method 3: All params sorted with & separator
      {
        string: Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&'),
        label: 'Method 3: All params sorted with & separator'
      },
      // Method 5: All params unsorted with & separator
      {
        string: Object.keys(params).map(key => `${key}=${params[key]}`).join('&'),
        label: 'Method 5: All params unsorted with & separator'
      },
      // Method 6: All params unsorted with no separator
      {
        string: Object.keys(params).map(key => `${key}=${params[key]}`).join(''),
        label: 'Method 6: All params unsorted with no separator'
      }
    ];
    
    for (const method of methods) {
      const methodSignature = crypto
        .createHmac('sha256', SHOPIFY_API_SECRET)
        .update(method.string)
        .digest('hex');
      
      if (signature === methodSignature) {
        return { valid: true, method: method.label };
      }
    }
    
    return { valid: false, method: 'All signature methods failed' };
  } catch (error) {
    return { valid: false, method: `Verification error: ${error.message}` };
  }
}