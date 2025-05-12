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
    
    // Process and enhance draft order with product information
    try {
      if (draft_order.line_items && Array.isArray(draft_order.line_items)) {
        console.log(`Processing ${draft_order.line_items.length} line items with product info`);
        
        // Extract product properties and handle variant data
        for (let i = 0; i < draft_order.line_items.length; i++) {
          const item = draft_order.line_items[i];
          console.log("Processing line item:", JSON.stringify(item));
          
          // Ensure required fields are present
          if (!item.title) {
            console.log("Line item missing title, adding placeholder");
            item.title = "Product Reservation";
          }
          
          // Ensure price is properly formatted
          if (item.price) {
            // If price is not a string, convert it to string with 2 decimal places
            if (typeof item.price !== 'string') {
              item.price = item.price.toFixed(2);
            }
            console.log(`Setting price for line item: ${item.price}`);
          }
          
          // Properly format custom properties
          if (item.properties && Array.isArray(item.properties)) {
            // Validate each property has required name/value pair
            item.properties = item.properties.filter(prop => 
              prop && typeof prop === 'object' && prop.name && prop.value !== undefined
            );
            
            console.log(`Line item has ${item.properties.length} properties`);
          }
        }
      } else {
        console.log("No line items found in draft order or incorrect format");
      }
    } catch (error) {
      console.error("Error processing line items:", error);
      // Continue processing even if there's an error with line items
    }
    
    // Add metadata for tracking and auditing
    draft_order.note_attributes = draft_order.note_attributes || [];
    draft_order.note_attributes.push(
      { name: "app_source", value: "shopify_extension_app" },
      { name: "created_at", value: new Date().toISOString() }
    );
    
    // Log the sanitized draft order (redacting sensitive info)
    const sanitizedDraftOrder = JSON.parse(JSON.stringify(draft_order));
    if (sanitizedDraftOrder.customer && sanitizedDraftOrder.customer.email) {
      sanitizedDraftOrder.customer.email = sanitizedDraftOrder.customer.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    }
    console.log("Creating draft order:", JSON.stringify(sanitizedDraftOrder, null, 2));
    
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
    
    // Get the admin URL for the draft order for easy access
    const draftOrderId = response.data.draft_order.id;
    const adminUrl = `https://${SHOP_DOMAIN}/admin/draft_orders/${draftOrderId}`;
    
    // Return successful response with admin URL
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        draft_order: response.data.draft_order,
        admin_url: adminUrl
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
    
    // Handle Shopify API errors more specifically
    if (error.response && error.response.data && error.response.data.errors) {
      return {
        statusCode: error.response.status || 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.response.data.errors
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